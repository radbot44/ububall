/* Rink presentation state, visual effects, audio dispatch and canvas rendering
   shared by live play, replays, video export and the Effects Demo (/effects). */
(function (root) {
  'use strict';

  const GOAL_WORDS = Object.freeze({
    'OWN GOAL': 'Own goal', 'HAT TRICK!': 'Hat trick', 'FIREBALL!': 'Fireball',
    'ONE-TIMER!': 'One-timer', 'BANK SHOT!': 'Bank shot', 'SNIPE!': 'Snipe',
    'REBOUND!': 'Rebound', 'ACE!': 'Ace', GOAL: 'Goal'
  });
  const callText = (label, name) => label === 'OWN GOAL' ? 'Own goal!' : `${GOAL_WORDS[label] || label.replace(/!$/, '')} by ${name}!`;

  const MATERIAL_STYLES = Object.freeze({
    metallic: ['spark', '#e1eaff'], glossy: ['bubble', '#ffffff'], iridescent: ['spark', 'rainbow'],
    crystalline: ['shard', '#a8eaff'], pearlescent: ['bubble', '#ffe5ed'], marble: ['dust', '#e5ddd1'],
    velvet: ['dust', null], frosted: ['spark', '#c9f4ff'], terrazzo: ['chip', null], crackle: ['spark', '#ffe4a5'],
    holographic: ['shard', 'rainbow'], woodgrain: ['streak', '#bf915f'], plush: ['dust', null],
    lacquered: ['streak', null], damascus: ['streak', '#ccd3e0'], opalescent: ['bubble', 'rainbow'],
    satin: ['streak', null], leather: ['chip', '#b18361'], denim: ['streak', '#8baee0'],
    'carbon-fiber': ['chip', '#83929d'], 'hammered-metal': ['spark', '#d5dbe2'], granite: ['chip', '#b0b0bc'],
    sandstone: ['dust', '#e3c28c'], obsidian: ['shard', '#a690c6'], liquid: ['bubble', null],
    bubbled: ['bubble', '#d2f7ff'], mosaic: ['chip', 'rainbow'], circuitry: ['spark', '#65ffd1'],
    quartz: ['shard', '#f4d7ff'], kintsugi: ['streak', '#ffd36b'], lava: ['spark', '#ff843e'],
    starfield: ['spark', '#e4d5ff']
  });

  const SUPER_AURA_THEMES = Object.freeze({
    cannonball: ['#ff3344', '#ff9954'], // fiery red & orange
    magnet: ['#3388ff', '#ff3344'],     // blue & red
    sticky: ['#42c66b', '#21845b'],     // emerald green & darker green
    stalwart: ['#ffd166', '#4f5fc2'],   // gold & indigo
    knockout: ['#ee2b47', '#ff7197'],   // crimson & pink
    colossus: ['#ffe043', '#c8961e'],   // yellow & darker yellow
    ghost: ['#33e0ff', '#f8f6f2'],      // cyan & alabaster
    shockwave: ['#ff7197', '#9d467a']   // rose & mulberry
  });

  const SKID_LIFE = 12;
  const SKID_SLOWDOWN = 220;
  const BURN_LIFE = 20;
  const GOAL_CALL_SECONDS = 2.4;
  const WALL_STEP = 2;
  const HEAT_COLORS = [[255, 255, 255], [255, 214, 170], [255, 158, 120], [255, 70, 30]];
  const MAX_CONIC_RING_SPRITES = 48;
  const MAX_SPRITE_CACHE = 64;

  const makePath = d => typeof Path2D === 'function' ? new Path2D(d) : Object.freeze({ path: d });
  const ALERT = makePath('M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01');
  const CHECK = makePath('M20 6 9 17l-5-5');
  const IGNITION_FLAME = makePath('M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.294 -2.333 5.588c0 3.704 3.134 6.706 7 6.706c3.866 0 7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235Z');
  const GUARD_SHIELD = makePath('M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3');
  const TARGET_ICON = makePath('M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0 M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0');
  const STUN_STARS = makePath('M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 -6 -6a6 6 0 0 1 6 -6a6 6 0 0 1 6 6a6 6 0 0 1 -6 6');

  function hexToRgba(hex, alpha) {
    let c = String(hex || '#ffffff').replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }

  function heatColor(h, alpha = 1) {
    const k = Math.min(2, Math.max(0, Math.floor(h))), t = Math.min(1, Math.max(0, h - k));
    const [a, b] = [HEAT_COLORS[k], HEAT_COLORS[k + 1]];
    const [r, g, bl] = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
  }

  function createMaterialEmitters(entries, stylesMap = MATERIAL_STYLES) {
    return (entries || []).map(entry => {
      const seen = new Set(), styles = [];
      for (const attribute of Object.values(entry?.model?.attributes || {})) {
        const style = stylesMap[attribute.texture];
        if (!style || seen.has(attribute.texture)) continue;
        seen.add(attribute.texture);
        styles.push({ shape: style[0], color: style[1] || attribute.hex });
      }
      return { styles, time: 0 };
    });
  }

  function createEffectsState(entries, stylesMap = MATERIAL_STYLES) {
    return {
      trails: Array.from({ length: 7 }, () => []),
      particles: [],
      fireworks: [],
      shockwaves: [],
      skids: [],
      skidState: [],
      burns: [],
      burnState: {},
      ripples: [],
      pings: [],
      popups: [],
      danger: [0, 0],
      ballFlare: 0,
      kickoffGlow: 0,
      goalSweep: null,
      goalCall: null,
      hitStopUntil: 0,
      shake: 0,
      shakeX: 0,
      shakeY: 0,
      fireTime: 0,
      heatTime: 0,
      sizzle: null,
      netFire: null,
      superImpactTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      carveTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      slipstreamTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      spinStrikeTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      puckSlideTime: -Infinity,
      lastCannonImpact: -Infinity,
      lastFireHitSound: -Infinity,
      materialEmitters: createMaterialEmitters(entries, stylesMap),
      iceCache: {},
      rinkCache: null
    };
  }

  function explodeShell(f, particles) {
    particles.push({ x: f.x, y: f.y, px: f.x, py: f.y, vx: 0, vy: 0, team: f.team, life: .34, duration: .34, flash: true, flashSize: f.ring ? 210 : 180, overlay: true });
    particles.push({ x: f.x, y: f.y, px: f.x, py: f.y, vx: 0, vy: 0, team: -1, color: '#fff7d6', life: .14, duration: .14, flash: true, flashSize: 95, overlay: true });
    const count = f.ring ? 76 : 80;
    for (let k = 0; k < count && particles.length < 850; k++) {
      let angle, speed, color = null, isCrackle, size;
      if (f.ring) {
        const inner = k >= 52;
        const idx = inner ? k - 52 : k, ringCount = inner ? 24 : 52;
        angle = (idx / ringCount) * Math.PI * 2 + (inner ? .13 : 0);
        speed = inner ? 108 + (idx % 2) * 14 : 215 + (idx % 2) * 16;
        color = inner ? (idx % 2 === 0 ? '#ffd76b' : '#ffffff') : (idx % 4 === 0 ? '#ffffff' : idx % 4 === 2 ? '#ffd76b' : null);
        isCrackle = !inner && (idx % 2 === 0 || Math.random() < .35);
        size = inner ? 1.7 : 2.2;
      } else {
        const pistil = k >= 60;
        angle = Math.random() * Math.PI * 2;
        const u = Math.random(), shell = Math.sqrt(1 - u * u);
        speed = pistil ? 45 + shell * 75 : (90 + shell * 175) * (.9 + Math.random() * .18);
        color = pistil ? (k % 2 === 0 ? '#ffd76b' : '#ffffff') : (k % 4 === 0 ? '#ffffff' : k % 5 === 0 ? '#ffd76b' : null);
        isCrackle = !pistil && Math.random() < .35;
        size = pistil ? 1.6 : 1.8 + shell * .55;
      }
      const life = isCrackle ? .52 + Math.random() * .38 : .95 + Math.random() * .65;
      particles.push({ x: f.x, y: f.y, px: f.x, py: f.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, team: f.team,
        color, size, life, duration: life, celebration: true, overlay: true, crackle: isCrackle, twinkle: Math.random() * 6.28 });
    }
  }

  function crackle(p, particles) {
    if (particles.length < 850) {
      particles.push({ x: p.x, y: p.y, px: p.x, py: p.y, vx: 0, vy: 0, team: -1, color: '#fff6d6',
        life: .09, duration: .09, flash: true, flashSize: 44, overlay: true });
    }
    for (let k = 0; k < 4 && particles.length < 850; k++) {
      const angle = (k / 4) * Math.PI * 2 + Math.random() * 1.1, speed = 55 + Math.random() * 65, life = .12 + Math.random() * .1;
      particles.push({ x: p.x, y: p.y, px: p.x, py: p.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        team: -1, color: k % 2 === 0 ? '#ffffff' : '#ffe49e', life, duration: life, snap: true, overlay: true });
    }
  }

  function updateParticles(dt, particles, fireworks, shockwaves, onFirework = null) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      if (p.life <= 0) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
        if (p.crackle) crackle(p, particles);
        continue;
      }
      p.px = p.x; p.py = p.y;
      const drag = Math.exp(-dt * (p.celebration ? 1.3 : 4));
      p.vx *= drag; p.vy = p.vy * drag + (p.celebration ? 95 : 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const f = fireworks[i];
      if ((f.delay -= dt) > 0) continue;
      f.x += (f.vx || 0) * dt; f.y += f.vy * dt; f.vy += 320 * dt; f.fuse -= dt;
      if (particles.length < 850) particles.push({ x: f.x, y: f.y, px: f.x, py: f.y - f.vy * .02,
        vx: (f.vx || 0) * .25 + (Math.random() - .5) * 36, vy: 28 + Math.random() * 24,
        team: f.team, color: Math.random() < .35 ? '#ffffff' : '#ffe9b0', life: .28, duration: .28, overlay: true });
      if (f.fuse <= 0) {
        explodeShell(f, particles);
        onFirework?.(f);
        fireworks[i] = fireworks[fireworks.length - 1];
        fireworks.pop();
      }
    }
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const s = shockwaves[i]; s.life -= dt;
      if (s.life <= 0) {
        shockwaves[i] = shockwaves[shockwaves.length - 1];
        shockwaves.pop();
      }
    }
  }

  function updatePopups(dt, popups, _reduced = false) {
    for (let i = popups.length - 1; i >= 0; i--) if ((popups[i].life -= dt) <= 0) popups.splice(i, 1);
  }

  function drawPopups(badgeCtx, popups, isPortrait, width, home, away, reduced = false, docRef = null) {
    const pxScale = Math.max(0.5, Math.min(4, (width || 1000) / 1000));
    const d = docRef || (typeof document !== 'undefined' ? document : null);
    for (const p of popups) {
      const duration = p.duration || 1.2;
      const age = 1 - p.life / duration, t = reduced ? 1 : Math.min(1, age / .2), scale = reduced ? 1 : 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
      const color = p.team ? away : home;
      badgeCtx.save(); badgeCtx.translate(p.x, reduced ? p.y : p.y - age * 22); if (isPortrait) badgeCtx.rotate(Math.PI / 2); badgeCtx.scale(scale, scale);
      badgeCtx.globalAlpha = age < .7 ? 1 : (1 - age) / .3;
      const key = `${p.text}\0${color}\0${width}`;
      let sprite = p._sprite?.key === key ? p._sprite : null;
      if (!sprite && d?.createElement && typeof badgeCtx.drawImage === 'function') {
        const sc = d.createElement('canvas');
        const sctx = sc?.getContext?.('2d');
        if (sctx && typeof sctx.fillText === 'function') {
          sctx.font = '900 26px system-ui, sans-serif';
          const tw = typeof sctx.measureText === 'function' ? (sctx.measureText(p.text)?.width || 220) : 220;
          const halfW = Math.ceil(Math.max(80, tw / 2) + 32), halfH = 44;
          const lw = halfW * 2, lh = halfH * 2;
          sc.width = Math.max(1, Math.ceil(lw * pxScale));
          sc.height = Math.max(1, Math.ceil(lh * pxScale));
          sctx.setTransform(pxScale, 0, 0, pxScale, halfW * pxScale, halfH * pxScale);
          sctx.font = '900 26px system-ui, sans-serif'; sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
          sctx.shadowColor = color; sctx.shadowBlur = 12 * pxScale;
          sctx.lineWidth = 4; sctx.strokeStyle = color; sctx.strokeText(p.text, 0, 0);
          sctx.fillStyle = '#ffffff'; sctx.fillText(p.text, 0, 0);
          sprite = p._sprite = { key, canvas: sc, halfW, halfH, lw, lh };
        }
      }
      if (sprite) {
        badgeCtx.drawImage(sprite.canvas, -sprite.halfW, -sprite.halfH, sprite.lw, sprite.lh);
      } else {
        badgeCtx.font = '900 26px system-ui, sans-serif'; badgeCtx.textAlign = 'center'; badgeCtx.textBaseline = 'middle';
        badgeCtx.shadowColor = color; badgeCtx.shadowBlur = 12 * width / 1000;
        badgeCtx.lineWidth = 4; badgeCtx.strokeStyle = color; badgeCtx.strokeText(p.text, 0, 0);
        badgeCtx.fillStyle = '#ffffff'; badgeCtx.fillText(p.text, 0, 0);
      }
      badgeCtx.restore();
    }
  }

  // The oomark face on the ball: eyes and mouth match brand SVG, recoloured with team colors on fire.
  function drawBallFace(ctx, size, eyeColor, mouthColor) {
    const scale = size / 298.99;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = eyeColor;
    ctx.lineWidth = 35.3374;
    for (const cx of [-59.445, 59.445]) {
      ctx.beginPath();
      ctx.arc(cx, -34.503, 48.3813, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = mouthColor;
    ctx.lineWidth = 53.0061;
    ctx.beginPath();
    ctx.moveTo(-75.9575, 74.0501);
    ctx.lineTo(75.9575, 74.0501);
    ctx.stroke();
    ctx.restore();
  }

  function drawTrails(ctx, trails, bodies, home, away, ballHeatFn = () => 0, heatColorFn = heatColor, rgbaFn = hexToRgba) {
    ctx.save();
    trails.forEach((trail, index) => {
      if (!trail.length) return;
      const b = bodies[index], color = b.team === -1 ? '#ffffff' : b.team === 0 ? home : away;
      const last = trail[trail.length - 1];
      const near = (b.x - last.x) ** 2 + (b.y - last.y) ** 2 < 4;
      const count = near ? trail.length - 1 : trail.length;
      const pts = [];
      for (let j = 0; j < count; j++) {
        trail[j].origIndex = j;
        trail[j].isHead = false;
        pts.push(trail[j]);
      }
      pts.push({ x: b.x, y: b.y, radius: b.radius, life: .24, duration: .24, heat: b.team === -1 ? ballHeatFn(b) : 0, origIndex: trail.length, isHead: true });

      const u = [];
      for (let j = 0; j < pts.length - 1; j++) {
        const dx = pts[j + 1].x - pts[j].x, dy = pts[j + 1].y - pts[j].y, len = Math.hypot(dx, dy);
        u.push(len > 0.001 ? { x: dx / len, y: dy / len } : (j > 0 ? u[j - 1] : { x: 1, y: 0 }));
      }

      const sections = [];
      let cur = [pts[0]];
      for (let j = 0; j < pts.length - 1; j++) {
        cur.push(pts[j + 1]);
        if (j < pts.length - 2) {
          const dot = u[j].x * u[j + 1].x + u[j].y * u[j + 1].y;
          if (dot < 0.2) {
            if (cur.length >= 2) sections.push(cur);
            cur = [pts[j + 1]];
          }
        }
      }
      if (cur.length >= 2) sections.push(cur);

      for (const sec of sections) {
        const m = sec.length - 1;
        if (m < 1) continue;
        const S0 = sec[0], Sm = sec[m];

        const L = [], R = [];
        for (let k = 0; k <= m; k++) {
          const pt = sec[k];
          let tx = 1, ty = 0;
          if (k === m && pt.isHead && b.vx * b.vx + b.vy * b.vy > 1) {
            const vlen = Math.hypot(b.vx, b.vy);
            tx = b.vx / vlen; ty = b.vy / vlen;
          } else {
            let dx, dy;
            if (k === 0) { dx = sec[1].x - sec[0].x; dy = sec[1].y - sec[0].y; }
            else if (k === m) { dx = sec[m].x - sec[m - 1].x; dy = sec[m].y - sec[m - 1].y; }
            else { dx = sec[k + 1].x - sec[k - 1].x; dy = sec[k + 1].y - sec[k - 1].y; }
            const d = Math.hypot(dx, dy);
            if (d > 0.001) { tx = dx / d; ty = dy / d; }
            else if (k > 0 && L[k - 1]) { tx = L[k - 1].tx; ty = L[k - 1].ty; }
          }

          const nx = -ty, ny = tx;
          const fade = pt.isHead ? 1 : Math.max(0, pt.life / pt.duration);
          const w = b.radius * fade;
          L.push({ x: pt.x + nx * w, y: pt.y + ny * w, tx, ty, w, fade, heat: pt.heat || 0 });
          R.push({ x: pt.x - nx * w, y: pt.y - ny * w, tx, ty, w, fade, heat: pt.heat || 0 });
        }

        const w0 = L[0].w;
        const backX = S0.x - L[0].tx * w0, backY = S0.y - L[0].ty * w0;
        if (Math.hypot(Sm.x - backX, Sm.y - backY) < 1) continue;

        ctx.beginPath();
        ctx.moveTo(L[0].x, L[0].y);
        for (let k = 1; k <= m; k++) ctx.lineTo(L[k].x, L[k].y);
        ctx.lineTo(R[m].x, R[m].y);
        for (let k = m - 1; k >= 0; k--) ctx.lineTo(R[k].x, R[k].y);

        if (w0 > 0.5) {
          const angR = Math.atan2(R[0].y - S0.y, R[0].x - S0.x);
          const angL = Math.atan2(L[0].y - S0.y, L[0].x - S0.x);
          ctx.arc(S0.x, S0.y, w0, angR, angL, true);
        }
        ctx.closePath();

        const grad = ctx.createLinearGradient(backX, backY, Sm.x, Sm.y);
        // Preserve each recorded heat value, including a brief hot spot between cool ends.
        // Distance-based stops avoid stretching closely spaced samples over the whole trail.
        const positions = [0];
        let length = 0;
        for (let k = 1; k <= m; k++) {
          length += Math.hypot(sec[k].x - sec[k - 1].x, sec[k].y - sec[k - 1].y);
          positions.push(length);
        }
        for (let k = 0; k <= m; k++) {
          const s = length > 0 ? positions[k] / length : k / m;
          const f = k === 0 && S0.origIndex === 0 ? 0 : L[k].fade;
          if (b.team === -1) {
            const h = L[k].heat;
            const base = 0.23 + Math.min(2, h) * 0.05 + Math.max(0, h - 2) * 0.3;
            const alpha = 1 - Math.pow(1 - Math.min(0.99, base * f), 18 * f);
            grad.addColorStop(s, heatColorFn(h, alpha));
          } else {
            const alpha = 1 - Math.pow(1 - 0.23 * f, 18 * f);
            grad.addColorStop(s, rgbaFn(color, alpha));
          }
        }
        ctx.fillStyle = grad;
        ctx.fill();
      }
    });
    ctx.restore();
  }

  const glowSprites = new Map();
  function glowSprite(color, doc = typeof document !== 'undefined' ? document : null) {
    const cached = glowSprites.get(color);
    if (cached && cached._doc === doc) {
      glowSprites.delete(color);
      glowSprites.set(color, cached);
      return cached;
    }
    const sprite = doc.createElement('canvas'); sprite.width = sprite.height = 128; sprite._doc = doc;
    const c = sprite.getContext('2d'); c.fillStyle = color;
    c.shadowColor = color; c.shadowBlur = 14;
    c.beginPath(); c.arc(64, 64, 6, 0, Math.PI * 2);
    c.fill();
    glowSprites.set(color, sprite);
    if (glowSprites.size > MAX_SPRITE_CACHE) glowSprites.delete(glowSprites.keys().next().value);
    return sprite;
  }

  const superGlowSprites = new Map();
  function superGlowSprite(key, doc = typeof document !== 'undefined' ? document : null) {
    const cached = superGlowSprites.get(key);
    if (cached && cached._doc === doc) {
      superGlowSprites.delete(key);
      superGlowSprites.set(key, cached);
      return cached;
    }
    const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
    const sprite = doc.createElement('canvas'); sprite.width = sprite.height = 256; sprite._doc = doc;
    const c = sprite.getContext('2d');
    const grad = c.createRadialGradient(128, 128, 10, 128, 128, 124);
    grad.addColorStop(0, hexToRgba(c1, 0.96));
    grad.addColorStop(0.18, hexToRgba(c1, 0.90));
    grad.addColorStop(0.26, hexToRgba(c1, 0.82));
    grad.addColorStop(0.38, hexToRgba(c2, 0.84));
    grad.addColorStop(0.48, hexToRgba(c2, 0.74));
    grad.addColorStop(0.60, hexToRgba(c1, 0.68));
    grad.addColorStop(0.72, hexToRgba(c1, 0.52));
    grad.addColorStop(0.84, hexToRgba(c2, 0.38));
    grad.addColorStop(0.92, hexToRgba(c2, 0.18));
    grad.addColorStop(1, hexToRgba(c2, 0));
    c.fillStyle = grad;
    c.beginPath(); c.arc(128, 128, 124, 0, Math.PI * 2); c.fill();
    superGlowSprites.set(key, sprite);
    if (superGlowSprites.size > MAX_SPRITE_CACHE) superGlowSprites.delete(superGlowSprites.keys().next().value);
    return sprite;
  }

  const conicRingSprites = new Map();
  function conicRingSprite(key, radius, lineWidth, doc = typeof document !== 'undefined' ? document : null) {
    const ringRadius = Math.round(radius);
    const spriteKey = `${key}:${ringRadius}:${lineWidth}`;
    const cached = conicRingSprites.get(spriteKey);
    if (cached) {
      conicRingSprites.delete(spriteKey);
      conicRingSprites.set(spriteKey, cached);
      return cached;
    }
    const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
    const pad = 16, size = Math.ceil((ringRadius + lineWidth + pad) * 2), scale = 2;
    const sprite = doc.createElement('canvas');
    sprite.width = sprite.height = size * scale;
    sprite.size = size;
    const c = sprite.getContext('2d');
    c.scale(scale, scale);
    const cx = size / 2, cy = size / 2;
    const sweep = c.createConicGradient(0, cx, cy);
    sweep.addColorStop(0, hexToRgba(c2, 0)); sweep.addColorStop(.3, hexToRgba(c2, .9));
    sweep.addColorStop(.36, hexToRgba(c1, 0)); sweep.addColorStop(1, hexToRgba(c1, 0));
    c.strokeStyle = sweep; c.lineWidth = lineWidth;
    c.shadowBlur = 6; c.shadowColor = c1;
    c.beginPath(); c.arc(cx, cy, ringRadius, 0, Math.PI * 2); c.stroke();
    conicRingSprites.set(spriteKey, sprite);
    if (conicRingSprites.size > MAX_CONIC_RING_SPRITES) conicRingSprites.delete(conicRingSprites.keys().next().value);
    return sprite;
  }

  const impactStamps = new Map();
  function impactStamp(color, doc = typeof document !== 'undefined' ? document : null) {
    const cached = impactStamps.get(color);
    if (cached && cached._doc === doc) {
      impactStamps.delete(color);
      impactStamps.set(color, cached);
      return cached;
    }
    const stamp = doc.createElement('canvas'); stamp.width = stamp.height = 128; stamp._doc = doc;
    const c = stamp.getContext('2d'); c.fillStyle = color;
    c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
    impactStamps.set(color, stamp);
    if (impactStamps.size > MAX_SPRITE_CACHE) impactStamps.delete(impactStamps.keys().next().value);
    return stamp;
  }

  function impulseGeometry(P, body, plan) {
    if (!body || !plan) return { ringR: 0, scale: 0, distance: 0, x: body?.x || 0, y: body?.y || 0, visible: false };
    const activeSuper = body.superActive || ((body.superArm && (body.meter ?? 0) >= 100) ? body.equippedSuper?.key : null);
    const isColossus = activeSuper === 'colossus';
    const isStalwart = activeSuper === 'stalwart';
    const effRadius = isColossus ? (body.superActive === 'colossus' ? body.radius : Math.max(body.baseRadius ?? body.radius, P.SUPER?.colossusRadius || 56.25)) : body.radius;
    const superScale = isColossus ? (P.SUPER?.colossusLaunch || 0.75) : (isStalwart ? (P.SUPER?.stalwartLaunch || 0.5) : 1);
    const agility = (body.sizeMult || 1) ** (P.SIZE?.launch ?? -0.16);
    const daze = 1 - (P.dazeSlow ? P.dazeSlow(body) : 0);
    const carve = P.carveDriveBoost ? P.carveDriveBoost(body, plan.spin || 0) : 1;
    const scale = 110 * ((body.impulse || P.IMPULSE) / P.IMPULSE) * superScale * agility * daze * carve;
    const ringR = Math.max(effRadius, body.reach || effRadius, 18) + 2;
    const distance = ringR + scale * plan.power;
    return { ringR, scale, distance, x: body.x + Math.cos(plan.angle) * distance, y: body.y + Math.sin(plan.angle) * distance,
      visible: plan.power > 0 && !body.stunned };
  }

  // A gain flashes a glint at the bar's growing end; a full bar shimmers.
  function setMeterFill(fill, meter) {
    const value = Math.min(100, Math.max(0, meter || 0));
    const valStr = String(value);
    const hasPrev = fill.dataset.value !== undefined && fill.dataset.value !== '';
    const previous = hasPrev ? Number(fill.dataset.value) : value;
    if (hasPrev && fill.dataset.value === valStr) return;
    fill.style.width = valStr + '%';
    fill.dataset.value = valStr;
    if (value > previous + .2) {
      if (!fill.classList.contains('gain')) {
        fill.classList.add('gain');
      } else {
        const anims = typeof fill.getAnimations === 'function' ? fill.getAnimations() : null;
        if (anims && anims.length) {
          for (const a of anims) { a.cancel?.(); a.play?.(); }
        } else {
          fill.classList.remove('gain'); void fill.offsetWidth; fill.classList.add('gain');
        }
      }
    }
    const isFull = value >= 100;
    if (fill.classList.contains?.('full') !== isFull) fill.classList.toggle('full', isFull);
  }

  function mountSkaterSprites(container, entries, ubuRender, onReady = null) {
    container.replaceChildren();
    const doc = container.ownerDocument || document;
    return entries.map(entry => {
      const node = doc.createElement('div'); node.className = 'skater';
      if (typeof ubuRender.sprite === 'function') {
        node.append(ubuRender.spriteImg(entry.model, 'ball-ubu', 256));
        container.append(node);
        ubuRender.sprite(entry.model, 256).then(url => {
          if (!url || !node.isConnected) return;
          const image = new Image();
          image.onload = () => {
            if (!node.isConnected) return;
            const sprite = doc.createElement('canvas'); sprite.width = sprite.height = 256;
            sprite.getContext('2d').drawImage(image, 0, 0, 256, 256);
            node.replaceChildren(sprite);
            onReady?.();
          };
          image.src = url;
        });
        return node;
      }
      const svg = ubuRender(entry.model, 'ball-ubu'); node.append(svg); container.append(node);
      const image = new Image();
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      image.onload = () => {
        const sprite = doc.createElement('canvas'); sprite.width = sprite.height = 256;
        sprite.getContext('2d').drawImage(image, 0, 0, 256, 256);
        node.replaceChildren(sprite); URL.revokeObjectURL(url);
        onReady?.();
      };
      image.onerror = () => URL.revokeObjectURL(url);
      image.src = url;
      return node;
    });
  }

  function createWallRuns(P) {
    const cornerRadius = P?.rink?.corner ?? 100, goalDepth = P?.rink?.goalDepth ?? 38;
    const wallRun = pieces => {
      const run = [];
      for (const piece of pieces) {
        const n = Math.max(1, Math.round(piece.length / WALL_STEP));
        for (let k = 0; k < n; k++) run.push(piece.at(k / n));
      }
      run.push(pieces[pieces.length - 1].at(1));
      return run;
    };
    const straight = (x1, y1, x2, y2, nx, ny) => ({
      length: Math.hypot(x2 - x1, y2 - y1),
      at: t => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, nx, ny })
    });
    const corner = (cx, cy, a1, a2) => ({
      length: Math.abs(a2 - a1) * cornerRadius,
      at: t => {
        const a = a1 + (a2 - a1) * t;
        return { x: cx + Math.cos(a) * cornerRadius, y: cy + Math.sin(a) * cornerRadius, nx: Math.cos(a), ny: Math.sin(a) };
      }
    });
    const boardRuns = [
      wallRun([straight(60, 230, 60, 160, -1, 0), corner(160, 160, Math.PI, 1.5 * Math.PI), straight(160, 60, 840, 60, 0, -1),
        corner(840, 160, -.5 * Math.PI, 0), straight(940, 160, 940, 230, 1, 0)]),
      wallRun([straight(940, 370, 940, 440, 1, 0), corner(840, 440, 0, .5 * Math.PI), straight(840, 540, 160, 540, 0, 1),
        corner(160, 440, .5 * Math.PI, Math.PI), straight(60, 440, 60, 370, -1, 0)])
    ];
    const netRuns = [60, 940].flatMap(mouth => {
      const out = mouth < 500 ? -1 : 1, back = mouth + out * goalDepth;
      return [wallRun([straight(mouth, 230, back, 230, 0, -1)]), wallRun([straight(back, 230, back, 370, out, 0)]),
        wallRun([straight(back, 370, mouth, 370, 0, 1)])];
    });
    return { boardRuns, netRuns };
  }

  function drawRinkSurface(g, P, ububallMatch, colors, rinkLogo = null) {
    const { surface, border, background, home, away } = colors;
    g.beginPath();
    g.roundRect(60, 60, 880, 480, 100);
    g.fillStyle = surface;
    g.fill();
    g.strokeStyle = border;
    g.lineWidth = 4;
    g.stroke();

    g.setLineDash([6, 10]);
    g.beginPath();
    g.moveTo(500, 60);
    g.lineTo(500, 540);
    g.strokeStyle = border;
    g.lineWidth = 2;
    g.stroke();
    g.setLineDash([]);

    // Centre ice: face-off circle and faint logo.
    g.fillStyle = surface;
    g.beginPath();
    g.arc(500, 300, 70, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(500, 300, 70, 0, Math.PI * 2);
    g.strokeStyle = border;
    g.lineWidth = 2;
    g.stroke();
    if (rinkLogo?.complete && rinkLogo.naturalWidth) {
      const w = 110, h = w * rinkLogo.naturalHeight / rinkLogo.naturalWidth;
      g.save();
      g.globalAlpha = .08;
      g.drawImage(rinkLogo, 500 - w / 2, 300 - h / 2, w, h);
      g.restore();
    }

    // Each goal's crease and attack zone line.
    g.setLineDash([6, 10]);
    for (const team of [0, 1]) {
      const x = team ? 940 : 60, from = team ? Math.PI / 2 : -Math.PI / 2, zone = ububallMatch.attackZoneLine(P, team);
      g.beginPath();
      g.arc(x, 300, ububallMatch.FOULS.crease, from, from + Math.PI);
      g.strokeStyle = border;
      g.lineWidth = 2;
      g.stroke();

      g.beginPath();
      g.moveTo(zone, 60);
      g.lineTo(zone, 540);
      g.strokeStyle = border;
      g.lineWidth = 2;
      g.stroke();
    }
    g.setLineDash([]);

    // Goal pockets: board cutout with open mouth, 3-sided net frame.
    const depth = P.rink.goalDepth;
    for (const [x, accent] of [[60 - depth, home], [940, away]]) {
      g.fillStyle = background;
      g.fillRect(x, 230, depth, 140);
      g.beginPath();
      g.moveTo(x, 230);
      g.lineTo(x + depth, 230);
      g.strokeStyle = accent;
      g.lineWidth = 4;
      g.stroke();

      g.beginPath();
      g.moveTo(x, 370);
      g.lineTo(x + depth, 370);
      g.strokeStyle = accent;
      g.lineWidth = 4;
      g.stroke();

      const backX = x === 60 - depth ? x : x + depth;
      g.beginPath();
      g.moveTo(backX, 230);
      g.lineTo(backX, 370);
      g.strokeStyle = accent;
      g.lineWidth = 4;
      g.stroke();
    }
  }

  // Stretched portrait rink for Collection: minimum 3:5 (600x1000), rounded ends and goals at top
  // and bottom, with zone lines and centre-ice face-off circles + logos repeating at regular intervals.
  function drawPortraitRinkSurface(g, P, ububallMatch, colors, rinkLogo = null, length = 1000, viewTop = 0, viewSpan = null) {
    const { surface, border, background, home, away } = colors;
    const L = Math.max(1000, Number(length) || 1000);
    const span = viewSpan == null ? L : Math.max(1, viewSpan);
    const visMin = viewTop - 130, visMax = viewTop + span + 130;
    const topY = 60, bottomY = L - 60, boardH = bottomY - topY;
    const creaseR = ububallMatch.FOULS.crease;
    const zoneOffset = ububallMatch.attackZoneLine(P, 0) - P.rink.left;
    const step = 500 - (topY + zoneOffset);

    g.beginPath();
    g.roundRect(60, topY, 480, boardH, 100);
    g.fillStyle = surface;
    g.fill();
    g.strokeStyle = border;
    g.lineWidth = 4;
    g.stroke();

    g.save();
    g.beginPath();
    g.roundRect(60, topY, 480, boardH, 100);
    g.clip();

    g.setLineDash([6, 10]);
    if (topY + creaseR >= visMin && topY <= visMax) {
      g.beginPath();
      g.arc(300, topY, creaseR, 0, Math.PI);
      g.strokeStyle = border;
      g.lineWidth = 2;
      g.stroke();
    }
    if (bottomY >= visMin && bottomY - creaseR <= visMax) {
      g.beginPath();
      g.arc(300, bottomY, creaseR, Math.PI, Math.PI * 2);
      g.strokeStyle = border;
      g.lineWidth = 2;
      g.stroke();
    }
    g.setLineDash([]);

    const firstY = topY + zoneOffset;
    const kStart = Math.max(0, Math.floor((visMin - firstY) / step));
    const kEnd = Math.max(-1, Math.ceil((Math.min(visMax, bottomY - creaseR) - firstY) / step));
    for (let k = kStart; k <= kEnd; k++) {
      const y = firstY + k * step;
      const isCenter = (k % 2) === 1;
      const clearY = isCenter ? bottomY - (creaseR + 90) : bottomY - zoneOffset;
      if (y > clearY + 24) continue;
      const alpha = y > clearY ? (clearY + 24 - y) / 24 : 1;
      g.save();
      if (alpha < 1) g.globalAlpha = Math.max(0, Math.min(1, alpha));
      g.setLineDash([6, 10]);
      g.beginPath();
      g.moveTo(60, y);
      g.lineTo(540, y);
      g.strokeStyle = border;
      g.lineWidth = 2;
      g.stroke();
      g.setLineDash([]);

      if (isCenter) {
        g.fillStyle = surface;
        g.beginPath();
        g.arc(300, y, 70, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(300, y, 70, 0, Math.PI * 2);
        g.strokeStyle = border;
        g.lineWidth = 2;
        g.stroke();
        if (rinkLogo?.complete && rinkLogo.naturalWidth) {
          const w = 110, h = w * rinkLogo.naturalHeight / rinkLogo.naturalWidth;
          g.save();
          g.globalAlpha = .08 * Math.max(0, Math.min(1, alpha));
          g.drawImage(rinkLogo, 300 - w / 2, y - h / 2, w, h);
          g.restore();
        }
      }
      g.restore();
    }
    g.restore();

    const depth = P.rink.goalDepth;
    if (topY >= visMin && topY - depth <= visMax) {
      g.fillStyle = background;
      g.fillRect(230, topY - depth, 140, depth);
      g.strokeStyle = away;
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(230, topY); g.lineTo(230, topY - depth); g.stroke();
      g.beginPath(); g.moveTo(370, topY); g.lineTo(370, topY - depth); g.stroke();
      g.beginPath(); g.moveTo(230, topY - depth); g.lineTo(370, topY - depth); g.stroke();
    }
    if (bottomY + depth >= visMin && bottomY <= visMax) {
      g.fillStyle = background;
      g.fillRect(230, bottomY, 140, depth);
      g.strokeStyle = home;
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(230, bottomY); g.lineTo(230, bottomY + depth); g.stroke();
      g.beginPath(); g.moveTo(370, bottomY); g.lineTo(370, bottomY + depth); g.stroke();
      g.beginPath(); g.moveTo(230, bottomY + depth); g.lineTo(370, bottomY + depth); g.stroke();
    }
  }

  function drawRinkLayer(ctx, width, height, P, ububallMatch, colors, rinkLogo, cache, doc = typeof document !== 'undefined' ? document : null) {
    const key = width + ',' + height + JSON.stringify(colors);
    if (cache?.key !== key) {
      const layer = doc.createElement('canvas'); layer.width = width; layer.height = height;
      const layerCtx = layer.getContext('2d');
      layerCtx.setTransform(width / 1000, 0, 0, height / 600, 0, 0);
      drawRinkSurface(layerCtx, P, ububallMatch, colors, rinkLogo);
      cache = { key, layer };
    }
    ctx.drawImage(cache.layer, 0, 0, 1000, 600);
    return cache;
  }

  function drawGuardShield(badgeCtx, b, isPortrait, iron) {
    badgeCtx.save();
    const p = isPortrait ? { x: b.x - b.radius * .65, y: b.y + b.radius * .65 } : { x: b.x + b.radius * .65, y: b.y + b.radius * .65 };
    badgeCtx.translate(p.x, p.y); if (isPortrait) badgeCtx.rotate(Math.PI / 2);
    badgeCtx.scale(1.1, 1.1); badgeCtx.translate(-12, -12); badgeCtx.fillStyle = iron ? '#c3ccd6' : '#4798ff';
    badgeCtx.fill(GUARD_SHIELD);
    if (iron) {
      badgeCtx.strokeStyle = '#6b7785';
      badgeCtx.lineWidth = 1.5;
      badgeCtx.stroke(GUARD_SHIELD);
    }
    badgeCtx.restore();
  }

  function createRinkPresenter(deps) {
    const bench = typeof window !== 'undefined' && (window.__ubuBench || /[?&]bench(?:=|&|$)/i.test(window.location?.search || ''))
      ? (window.__ubuBench ||= { flags: {}, rec: null }) : null;
    const {
      P,
      ububallMatch,
      ububallReplay = root.ububallReplay,
      getView,
      getEffects,
      getActivePlayback = () => null,
      getTheater = () => null,
      getPhase = () => 'play',
      getPlans = () => [],
      getSelected = () => 0,
      getTurn = () => 1,
      getElapsed = () => 0,
      getFouls = () => ububallMatch.newFouls(),
      getFoulInfo = () => null,
      getScoringPlayer = () => null,
      getGoalReplay = () => null,
      getOnline = () => null,
      getOnlineReplay = () => null,
      isCardShot = () => false,
      isDragging = () => false,
      isMoving = () => true,
      getGuide = () => null,
      guideShown = () => false,
      getSkaters = () => [],
      getRinkWrap = () => null,
      getRenderSize = null,
      isReducedMotion = () => false,
      clockNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      gameAudio = () => null,
      uiScale = () => 1,
      anonymousName = i => `Player ${i + 1}`,
      contactMeter = null,
      setHitStopUntil = null,
      onClearPostGoal = null,
      onAssetLoad = null,
      doc = typeof document !== 'undefined' ? document : null
    } = deps;

    const { HEAT } = P;
    const { boardRuns: BOARD_RUNS, netRuns: NET_RUNS } = createWallRuns(P);

    const hasImage = typeof Image === 'function';
    const ballMark = deps.ballMark ?? (hasImage ? new Image() : { complete: false, naturalWidth: 0 });
    const rinkLogo = deps.rinkLogo ?? (hasImage ? new Image() : { complete: false, naturalWidth: 0 });
    const superImages = deps.superImages ?? (hasImage ? P.SUPERS.map(s => {
      const img = new Image();
      img.src = s.icon;
      img.onload = () => onAssetLoad?.();
      return img;
    }) : []);
    if (hasImage && !deps.ballMark) {
      ballMark.src = 'assets/uburoom-oomark-brand.svg';
      ballMark.onload = () => onAssetLoad?.();
    }
    if (hasImage && !deps.rinkLogo) {
      rinkLogo.src = 'assets/ububall-logo.svg';
      rinkLogo.onload = () => {
        const fx = getEffects();
        if (fx) fx.rinkCache = null;
        onAssetLoad?.();
      };
    }

    let themeColors = null, themeObserver = null, darkMedia = null, onDarkChange = null;
    function invalidateTheme() {
      themeColors = null;
      const fx = getEffects();
      if (fx) fx.rinkCache = null;
    }
    if (typeof MutationObserver === 'function' && doc?.documentElement) {
      themeObserver = new MutationObserver(() => { invalidateTheme(); onAssetLoad?.(); });
      themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
      if (doc.body) themeObserver.observe(doc.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    }
    if (typeof matchMedia === 'function') {
      darkMedia = matchMedia('(prefers-color-scheme: dark)');
      onDarkChange = () => { invalidateTheme(); onAssetLoad?.(); };
      darkMedia.addEventListener?.('change', onDarkChange);
    }
    function dispose() {
      themeObserver?.disconnect();
      themeObserver = null;
      if (darkMedia && onDarkChange) darkMedia.removeEventListener?.('change', onDarkChange);
      darkMedia = null; onDarkChange = null;
      stopFanfare();
      quench();
    }

    function getThemeColors() {
      if (!themeColors) {
        if (typeof getComputedStyle === 'function' && doc?.documentElement) {
          const theme = getComputedStyle(doc.documentElement);
          const color = name => theme.getPropertyValue('--' + name).trim();
          themeColors = {
            primary: color('primary') || '#ff7197',
            secondary: color('secondary') || '#ff9954',
            home: color('team-home') || '#E8CA48',
            away: color('team-away') || '#AA54D3',
            text: color('text') || '#f2efe9',
            border: color('border') || '#333539',
            surface: color('elevated') || '#1b1d21',
            background: color('background') || '#101112'
          };
        } else {
          themeColors = {
            primary: '#ff7197', secondary: '#ff9954', home: '#E8CA48', away: '#AA54D3',
            text: '#f2efe9', border: '#333539', surface: '#1b1d21', background: '#101112'
          };
        }
      }
      return themeColors;
    }

    const pulseMode = () => ububallMatch.rule(getView().mode, 'pulse');
    const paceShare = ball => Math.max(Math.hypot(ball.vx, ball.vy), ball.pace || 0) / P.BASE_LAUNCH_SPEED;
    const ballOnFire = () => Boolean(getEffects().netFire?.lit) || P.ballOnFire(getView().bodies?.[6]);

    function quench() {
      const fx = getEffects();
      fx.sizzle?.stop();
      fx.sizzle = null;
      gameAudio()?.stopMotion?.();
    }

    function ballHeat(b) {
      const fx = getEffects();
      if (b.team === -1 && P.ballOnFire?.(b)) return 3;
      if (ballOnFire()) return 3;
      const s = paceShare(b);
      const level = s < HEAT.red ? (s - HEAT.orange) / (HEAT.red - HEAT.orange) : 1 + (s - HEAT.red) / (HEAT.redHot - HEAT.red);
      return Math.max(fx.ballFlare, Math.min(2, Math.max(0, level)));
    }

    function markIce(b, i, dt) {
      const fx = getEffects();
      const s = fx.skidState[i] ||= { time: 0 }, prev = s.prev;
      s.prev = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
      if (!prev || dt <= 0) return;
      if (Math.hypot(b.x - prev.x, b.y - prev.y) > 60) { s.time = 0; s.path = null; return; }
      const slowed = Math.hypot(prev.vx, prev.vy) - Math.hypot(b.vx, b.vy);
      if (slowed > SKID_SLOWDOWN) {
        const strength = Math.min(1, slowed / 600);
        Object.assign(s, { time: .3, strength: Math.max(s.time > 0 ? s.strength : 0, strength) });
        const now = clockNow(), map = (fx.carveTimes ||= new WeakMap());
        if (now - (map.get(b) ?? -Infinity) >= 180) {
          map.set(b, now);
          gameAudio()?.playCarve?.({ volume: Math.min(0.55, 0.18 + 0.36 * strength), speed: Math.hypot(prev.vx, prev.vy), x: b.x, y: b.y });
        }
      }
      if (s.time <= 0) { s.path = null; return; }
      const depth = s.strength * s.time / .3;
      s.time -= dt;
      if (!s.path) {
        s.path = { points: [{ x: prev.x, y: prev.y, depth }], width: b.radius * 1.7, age: 0 };
        fx.skids.push(s.path); if (fx.skids.length > 30) fx.skids.shift();
      }
      s.path.points.push({ x: b.x, y: b.y, depth }); s.path.age = 0;
    }

    function flames(x, y, spread, vx, vy, amount, spreadY = spread) {
      const fx = getEffects();
      for (let k = Math.ceil(amount); k > 0 && fx.particles.length < 850; k--) {
        const px = x + (Math.random() - .5) * spread, py = y + (Math.random() - .5) * spreadY, life = .18 + Math.random() * .22;
        fx.particles.push({ x: px, y: py, px, py, vx: vx + (Math.random() - .5) * 50, vy: vy + (Math.random() - .5) * 50,
          team: -1, color: ['#fff3b0', '#ffc43d', '#ff7a1a', '#ff3b1a'][Math.floor(Math.random() * 4)], life, duration: life, flame: 10 + Math.random() * 12 });
      }
    }

    function sparkBall(ball, dt) {
      if (!ball) return;
      const fx = getEffects();
      const speed = Math.hypot(ball.vx, ball.vy), share = paceShare(ball);
      const burning = ballOnFire();
      const wasBurning = fx.wasOnFire;
      fx.wasOnFire = burning;
      fx.fireTime = P.ballOnFire(ball) ? fx.fireTime + dt : 0;
      if (burning) {
        if (wasBurning === false && !fx.netFire?.lit && (clockNow() - (fx.lastCannonImpact ?? -Infinity) > 40)) {
          fx.ballFlare = 1;
          const spd = Math.hypot(ball.vx || 0, ball.vy || 0) || 1;
          const nx = -(ball.vx || 0) / spd, ny = -(ball.vy || 0) / spd;
          fx.fireWarp = { x: ball.x, y: ball.y, nx, ny, life: 0.30, duration: 0.30 };
          if (!isReducedMotion()) {
            if (fx.shockwaves.length < 30) {
              fx.shockwaves.push({
                x: ball.x, y: ball.y,
                currentRadius: ball.radius * 0.85, maxRadius: ball.radius * 3.1,
                team: -1, color: '#ff7a1a',
                dramatic: true, band: true, width: 6.2,
                life: 0.26, duration: 0.26, overlay: true
              });
              fx.shockwaves.push({
                x: ball.x, y: ball.y,
                currentRadius: ball.radius * 0.65, maxRadius: ball.radius * 2.1,
                team: -1, color: '#fff3b0',
                dramatic: true, width: 3.4,
                life: 0.18, duration: 0.18, overlay: true
              });
            }
            if (fx.particles.length < 400) {
              fx.particles.push({ x: ball.x, y: ball.y, px: ball.x, py: ball.y, vx: 0, vy: 0, team: -1, color: '#ff7a1a', life: 0.20, duration: 0.20, flash: true, flashSize: 120, overlay: true });
              fx.particles.push({ x: ball.x, y: ball.y, px: ball.x, py: ball.y, vx: 0, vy: 0, team: -1, color: '#fff3b0', life: 0.12, duration: 0.12, flash: true, flashSize: 64, overlay: true });
            }
            const backAng = Math.atan2(-(ball.vy || 0), -(ball.vx || 1));
            for (let k = 0; k < 16 && fx.particles.length < 400; k++) {
              const ang = backAng + (Math.random() - 0.5) * 1.9;
              const spd = 120 + Math.random() * 210, life = 0.18 + Math.random() * 0.14;
              const sx = ball.x + Math.cos(ang) * (ball.radius * 0.6);
              const sy = ball.y + Math.sin(ang) * (ball.radius * 0.6);
              fx.particles.push({
                x: sx, y: sy, px: sx - Math.cos(ang) * 7, py: sy - Math.sin(ang) * 7,
                vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
                team: -1, color: ['#fff3b0', '#ffc43d', '#ff7a1a', '#ff3b1a'][k % 4],
                life, duration: life,
                materialShape: k < 8 ? 'streak' : undefined,
                size: k < 8 ? 2.6 + Math.random() * 1.6 : undefined,
                angle: ang, snap: true, overlay: true
              });
            }
          }
          const now = clockNow();
          if (gameAudio()?.playFireImpact && (now - (fx.lastFireHitSound ?? -Infinity) > 55)) {
            fx.lastFireHitSound = now;
            gameAudio().playFireImpact({ volume: 0.68, x: ball.x, y: ball.y });
          }
        }
        if (!fx.sizzle) fx.sizzle = gameAudio()?.playSizzle?.({ x: ball.x, y: ball.y }) || null;
        else if (fx.sizzle?.setCoords) fx.sizzle.setCoords(ball.x, ball.y);
      } else {
        quench();
      }
      const level = Math.max(fx.ballFlare, (share - HEAT.red) / (HEAT.redHot - HEAT.red));
      const ux = speed ? ball.vx / speed : 0, uy = speed ? ball.vy / speed : -1;
      if (ballOnFire() && !fx.netFire?.lit) flames(ball.x - ux * ball.radius * .5, ball.y - uy * ball.radius * .5, ball.radius * 1.4, -ball.vx * .12, -ball.vy * .12, dt * 120);
      if (level <= 0 || speed < 1 || fx.netFire?.lit) return;
      const count = Math.ceil(dt * 90 * Math.min(1, level));
      for (let k = 0; k < count && fx.particles.length < 850; k++) {
        const x = ball.x - ux * ball.radius, y = ball.y - uy * ball.radius, life = .2 + Math.random() * .2;
        fx.particles.push({ x, y, px: x, py: y, vx: -ball.vx * .25 + (Math.random() - .5) * 160, vy: -ball.vy * .25 + (Math.random() - .5) * 160,
          team: -1, color: Math.random() < .5 ? '#ffb347' : '#fff1c1', life, duration: life });
      }
    }

    function burnNet(dt) {
      const fx = getEffects();
      if (!fx.netFire?.lit || isReducedMotion()) return;
      const mouth = fx.netFire.mouth, depth = P.rink.goalDepth;
      const back = mouth < 500 ? mouth - depth : mouth + depth;
      const midX = (mouth + back) / 2, midY = (P.rink.goalTop + P.rink.goalBottom) / 2;
      const height = P.rink.goalBottom - P.rink.goalTop;
      flames(midX, midY, depth, 0, 0, dt * 210, height);
      const sparks = Math.ceil(dt * 90);
      for (let k = 0; k < sparks && fx.particles.length < 850; k++) {
        const x = midX + (Math.random() - .5) * depth, y = midY + (Math.random() - .5) * height, life = .2 + Math.random() * .2;
        fx.particles.push({ x, y, px: x, py: y, vx: (Math.random() - .5) * 140, vy: (Math.random() - .5) * 140,
          team: -1, color: Math.random() < .5 ? '#ffb347' : '#fff1c1', life, duration: life });
      }
      if (!fx.sizzle) fx.sizzle = gameAudio()?.playSizzle?.() || null;
    }

    function lightNet(team) {
      getEffects().netFire = { mouth: team ? P.rink.left : P.rink.right, lit: true };
    }

    function burnIce(ball) {
      if (!ball) return;
      const fx = getEffects();
      const last = fx.burnState.path?.points.at(-1);
      if (fx.netFire?.lit) return;
      if (!ballOnFire() || (last && Math.hypot(ball.x - last.x, ball.y - last.y) > 60)) fx.burnState.path = null;
      if (!ballOnFire()) return;
      if (!fx.burnState.path) {
        fx.burnState.path = { points: [], width: ball.radius * 1.3, age: 0 };
        fx.burns.push(fx.burnState.path); if (fx.burns.length > 30) fx.burns.shift();
      }
      const points = fx.burnState.path.points, previous = points.at(-1);
      const depth = .2 + .8 * Math.min(1, fx.fireTime / .5);
      if (!previous || Math.hypot(ball.x - previous.x, ball.y - previous.y) >= 3) points.push({ x: ball.x, y: ball.y, depth });
      fx.burnState.path.age = 0;
    }

    function emitSkaterEffects(dt) {
      const fx = getEffects(), view = getView(), audio = gameAudio(), reduced = isReducedMotion();
      const now = clockNow();
      view.bodies.slice(0, 6).forEach((b, i) => {
        if (!reduced) markIce(b, i, dt);
        const speed = Math.hypot(b.vx || 0, b.vy || 0);
        if (audio && !b.carded) {
          audio.playUbuMove?.({ id: i, speed, mass: b.mass || 3, radius: b.radius || 25, slot: i, x: b.x, y: b.y });
          audio.playSpin?.({ id: i, omega: b.omega || 0, radius: b.radius || 25, slot: i, x: b.x, y: b.y });
        }
        if (b.superActive === 'ghost' && !b.carded) {
          const gMap = (fx.ghostPhaseTimes ||= new Map());
          for (let j = 0; j < 6; j++) {
            if (j === i) continue;
            const other = view.bodies[j];
            if (!other || other.team === b.team || other.carded) continue;
            const dist = Math.hypot(b.x - other.x, b.y - other.y);
            if (dist < (b.radius || 25) + (other.radius || 25) - 2) {
              const pairKey = i < j ? `${i}-${j}` : `${j}-${i}`;
              if (now - (gMap.get(pairKey) ?? -Infinity) >= 420) {
                gMap.set(pairKey, now);
                const midX = (b.x + other.x) * 0.5, midY = (b.y + other.y) * 0.5;
                if (!reduced) {
                  if (fx.shockwaves.length < 30) {
                    fx.shockwaves.push({
                      x: midX, y: midY, currentRadius: 11, maxRadius: 56,
                      team: b.team, color: '#33e0ff',
                      dramatic: true, band: true, width: 4.5,
                      life: 0.28, duration: 0.28, overlay: true
                    });
                    fx.shockwaves.push({
                      x: midX, y: midY, currentRadius: 7, maxRadius: 38,
                      team: b.team, color: '#f8f6f2',
                      dramatic: true, width: 2.4,
                      life: 0.20, duration: 0.20, overlay: true
                    });
                  }
                  if (fx.particles.length < 400) {
                    fx.particles.push({
                      x: midX, y: midY, px: midX, py: midY, vx: 0, vy: 0,
                      team: -1, color: '#33e0ff', life: 0.18, duration: 0.18,
                      flash: true, flashSize: 88, overlay: true
                    });
                  }
                  const passAng = Math.atan2(b.vy || (other.y - b.y), b.vx || (other.x - b.x));
                  for (let k = 0; k < 12 && fx.particles.length < 400; k++) {
                    const ang = passAng + (k / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
                    const spd = 95 + Math.random() * 140, life = 0.18 + Math.random() * 0.12;
                    const sx = midX + Math.cos(ang) * 8, sy = midY + Math.sin(ang) * 8;
                    fx.particles.push({
                      x: sx, y: sy, px: sx - Math.cos(ang) * 6, py: sy - Math.sin(ang) * 6,
                      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
                      team: -1, color: k % 3 === 0 ? '#f8f6f2' : '#33e0ff',
                      life, duration: life,
                      materialShape: k % 2 === 0 ? 'streak' : undefined,
                      size: k % 2 === 0 ? 2.2 + Math.random() * 1.4 : undefined,
                      angle: ang, snap: true, overlay: true
                    });
                  }
                }
                audio?.playSuper?.('ghost', 'phase', { volume: 0.72, x: midX, y: midY });
              }
            }
          }
        }
        const draft = P.tailgateFactor ? P.tailgateFactor(view.bodies, b) : 0;
        if (draft > 0.32) {
          if (!reduced && draft > 0.35) {
            const s = speed || 1, ux = b.vx / s, uy = b.vy / s;
            const rate = dt * 36 * draft;
            const count = Math.floor(rate) + (Math.random() < (rate % 1) ? 1 : 0);
            for (let k = 0; k < count && fx.particles.length < 340; k++) {
              const spread = (Math.random() - .5) * b.radius * 1.05;
              const x = b.x - ux * (b.radius * .6) - uy * spread;
              const y = b.y - uy * (b.radius * .6) + ux * spread;
              const life = .12 + Math.random() * .09, wakeSpeed = 68 + s * .2;
              fx.particles.push({ x, y, px: x + ux * 6, py: y + uy * 6,
                vx: -ux * wakeSpeed + (Math.random() - .5) * 20, vy: -uy * wakeSpeed + (Math.random() - .5) * 20,
                team: -1, color: k % 2 ? '#d6f6ff' : '#ffffff', life, duration: life });
            }
          }
          if (draft > 0.35 && audio?.playSlipstream) {
            const map = (fx.slipstreamTimes ||= new WeakMap());
            if (now - (map.get(b) ?? -Infinity) >= 85) {
              map.set(b, now);
              audio.playSlipstream({ draft, volume: Math.min(0.75, 0.24 + 0.48 * draft), duration: 0.2, x: b.x, y: b.y });
            }
          }
        }
      });
      const ball = view.bodies[6];
      if (ball && audio?.playPuckSlide && !P.holder?.(view.bodies)) {
        const bSpeed = Math.hypot(ball.vx || 0, ball.vy || 0);
        if (bSpeed >= 30 && now - (fx.puckSlideTime ?? -Infinity) >= 80) {
          fx.puckSlideTime = now;
          audio.playPuckSlide({
            speed: bSpeed,
            spin: ball.omega || 0,
            x: ball.x,
            y: ball.y,
            duration: 0.18
          });
        }
      }
      if (reduced) return;
      sparkBall(ball, dt);
      burnIce(ball);
      fx.materialEmitters.forEach((emitter, i) => {
        const b = view.bodies[i];
        if (!b) return;
        const speed = Math.hypot(b.vx, b.vy);
        if (speed < 25 || !emitter.styles.length) { emitter.time = 0; return; }
        emitter.time += dt;
        if (emitter.time < 1 / 24) return;
        emitter.time %= 1 / 24;
        for (const effect of emitter.styles) {
          if (fx.particles.length >= 300) break;
          const spread = (Math.random() - .5) * b.radius * 1.4;
          const x = b.x - b.vx / speed * b.radius - b.vy / speed * spread;
          const y = b.y - b.vy / speed * b.radius + b.vx / speed * spread;
          const life = .3 + Math.random() * .3;
          const color = effect.color === 'rainbow' ? `hsl(${Math.floor(Math.random() * 360)} 85% 78%)` : effect.color;
          fx.particles.push({ x, y, px: x, py: y, vx: -b.vx * .06 + (Math.random() - .5) * 28,
            vy: -b.vy * .06 + (Math.random() - .5) * 28, team: b.team, color, life, duration: life,
            materialShape: effect.shape, size: 1.5 + Math.random() * 2, angle: Math.random() * Math.PI });
        }
      });
    }

    function clearMotionEffects(fx = getEffects()) {
      const view = getView(), rinkWrap = getRinkWrap();
      fx.trails.forEach(trail => { trail.length = 0; });
      fx.particles.length = fx.fireworks.length = fx.shockwaves.length = 0;
      fx.skids.length = fx.skidState.length = fx.burns.length = fx.ripples.length = fx.pings.length = 0;
      fx.burnState.path = null;
      fx.heatTime = 0;
      if (fx.netFire) fx.netFire.lit = false;
      fx.shake = fx.shakeX = fx.shakeY = 0; if (!view.field && rinkWrap) rinkWrap.style.translate = '';
      fx.danger[0] = fx.danger[1] = fx.ballFlare = fx.kickoffGlow = 0; fx.goalSweep = fx.fireWarp = fx.koWarp = null;
      if (fx.iceCache) { fx.iceCache.key = null; fx.iceCache.skidSnap = null; fx.iceCache.burnSnap = null; }
    }

    function clearEffects() {
      const fx = getEffects(), view = getView();
      if (!view.field) onClearPostGoal?.();
      clearMotionEffects(fx);
      fx.popups.length = 0;
      fx.fireTime = 0; fx.wasOnFire = null; quench();
      fx.goalCall = null;
      fx.puckSlideTime = -Infinity;
      fx.lastCannonImpact = -Infinity;
      fx.lastFireHitSound = -Infinity;
      fx.lastHipClipSound = -Infinity;
      fx.ghostPhaseTimes = new Map();
      fx.superImpactTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      fx.carveTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      fx.slipstreamTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      fx.spinStrikeTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      if (Array.isArray(view.bodies)) {
        for (const b of view.bodies) {
          if (b && typeof b === 'object') {
            delete b._lastWallSound;
            delete b._lastHitSound;
          }
        }
      }
    }

    function burst(x, y, team, strength, celebration = false, tangent = 0, color = null) {
      if (isReducedMotion()) return;
      const fx = getEffects();
      const count = celebration ? 64 : Math.round(3 + strength * 4);
      for (let i = 0; i < count && fx.particles.length < 400; i++) {
        const angle = celebration ? Math.random() * Math.PI * 2
          : tangent + (i % 2 ? Math.PI : 0) + (Math.random() - .5) * .6;
        const speed = celebration ? 60 + Math.random() * 190 : 20 + Math.max(0, strength - 1) * 20 + Math.random() * (35 + strength * 65);
        const life = celebration ? .8 + Math.random() * .8 : .14 + Math.random() * .16 + Math.max(0, strength - 1) * .05;
        fx.particles.push({ x, y, px: x, py: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          team: i % 5 === 0 ? -1 : team, life, duration: life, celebration, color, overlay: celebration });
      }
    }

    function steamRing(x, y, r) {
      if (isReducedMotion()) return;
      const fx = getEffects();
      for (let i = 0; i < 24 && fx.particles.length < 380; i++) {
        const angle = (i / 24) * Math.PI * 2 + (Math.random() - .5) * 0.2;
        const dist = r * (0.8 + Math.random() * 0.4);
        const px = x + Math.cos(angle) * dist, py = y + Math.sin(angle) * dist;
        const speed = 70 + Math.random() * 90;
        const life = 0.35 + Math.random() * 0.25;
        fx.particles.push({
          x: px, y: py, px, py,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          team: -1, color: Math.random() < 0.6 ? '#ffffff' : '#d2f2ff',
          life, duration: life, size: 2 + Math.random() * 3
        });
      }
    }

    let fanfareLoop = null;
    function loopFanfare(voice) {
      stopFanfare();
      if (voice && gameAudio()) fanfareLoop = gameAudio().playFanfare(voice, null, null, { loop: true });
    }
    function stopFanfare() {
      fanfareLoop?.stop();
      fanfareLoop = null;
    }

    function celebrate(team, ball, label = 'GOAL', scorer = null) {
      const fx = getEffects(), view = getView();
      fx.goalCall = { team, label, scorer: scorer ? view.bodies.indexOf(scorer) : -1, name: scorer?.name || '', t: 0 };
      if (isReducedMotion()) return;
      burst(ball.x, ball.y, team, 1, true);
      fx.goalSweep = { team, p: 0 };
      const netSide = team ? 0 : 1;
      const netRun = NET_RUNS[netSide];
      if (netRun && fx.ripples.length < 24) {
        const shotSpeed = Math.hypot(ball.vx || 0, ball.vy || 0) || (ball.pace || 520);
        fx.ripples.push({
          run: netRun, lo: 0, hi: netRun.length - 1,
          net: true, goalPocket: true, side: netSide,
          amp: Math.min(1.45, Math.max(0.78, shotSpeed / 460)),
          life: 0.85, duration: 0.85
        });
      }
      for (let i = 0; i < 9; i++) fx.fireworks.push({ x: team === 0 ? 560 + Math.random() * 340 : 100 + Math.random() * 340, y: 560,
        vx: (Math.random() - .5) * 64, vy: -(430 + Math.random() * 160), fuse: .55 + Math.random() * .3, delay: .1 + i * .17, team, ring: i % 3 === 2 });
    }

    function goalThreat() {
      const bodies = getView().bodies;
      const ball = bodies[6];
      if (!ball || P.holder?.(bodies)) return null;
      const speed = Math.hypot(ball.vx, ball.vy), horizon = .9;
      if (speed < 120) return null;
      const turn = Math.abs(ball.omega || 0) * P.ballCurveFactor(ball, true) * horizon;
      const horizontalReach = horizon * (Math.abs(ball.vx) + speed * Math.min(1, turn));
      if (ball.x - horizontalReach > 60 && ball.x + horizontalReach < 940) return null;
      const sim = [{ ...ball }], limit = Math.round(horizon / P.DT);
      let boards = false;
      const onWall = (b, v, type) => { if (type === 'wall') boards = true; };
      for (let t = 1; t <= limit && !boards; t++) {
        const goal = P.step(sim, P.DT, null, onWall);
        if (goal !== null) return { side: goal === 1 ? 0 : 1, level: Math.min(1, speed / 500) * (1 - t / limit) };
      }
      return null;
    }

    function updateEffects(dt, fx = getEffects()) {
      const fieldFx = getEffects(), view = getView(), rinkWrap = getRinkWrap();
      if (isReducedMotion()) {
        clearMotionEffects(fx);
        if (fx !== fieldFx) clearMotionEffects(fieldFx);
        if (fieldFx.goalCall && (fieldFx.goalCall.t += dt) >= GOAL_CALL_SECONDS) fieldFx.goalCall = null;
        return;
      }
      if (Number.isFinite(dt) && dt > 0) {
        fx.heatTime = (fx.heatTime || 0) + dt;
        if (fieldFx && fieldFx !== fx) fieldFx.heatTime = (fieldFx.heatTime || 0) + dt;
      }
      for (const trail of fx.trails) {
        for (const point of trail) point.life -= dt;
        while (trail.length && trail[0].life <= 0) trail.shift();
      }
      updateParticles(dt, fx.particles, fx.fireworks, fx.shockwaves, f => {
        gameAudio()?.playFirework?.({
          ring: Boolean(f.ring),
          x: f.x,
          y: f.y,
          volume: 0.55
        });
      });
      const moving = isMoving();
      if (moving) for (const s of fieldFx.skids) s.age += dt;
      for (let i = fieldFx.skids.length - 1; i >= 0; i--) if (fieldFx.skids[i].age >= SKID_LIFE) fieldFx.skids.splice(i, 1);
      if (moving) for (const s of fieldFx.burns) s.age += dt;
      for (let i = fieldFx.burns.length - 1; i >= 0; i--) if (fieldFx.burns[i].age >= BURN_LIFE) fieldFx.burns.splice(i, 1);
      for (const list of [fieldFx.ripples, fieldFx.pings]) {
        for (let i = list.length - 1; i >= 0; i--) if ((list[i].life -= dt) <= 0) list.splice(i, 1);
      }
      const threat = moving ? goalThreat() : null;
      for (const side of [0, 1]) fieldFx.danger[side] += ((threat?.side === side ? threat.level : 0) - fieldFx.danger[side]) * Math.min(1, dt * 10);
      burnNet(dt);
      const scale = uiScale();
      fieldFx.shake = Math.max(0, fieldFx.shake - dt / .2);
      fieldFx.shakeX = fieldFx.shake ? Number(((Math.random() - .5) * 5 * scale * fieldFx.shake).toFixed(2)) : 0;
      fieldFx.shakeY = fieldFx.shake ? Number(((Math.random() - .5) * 5 * scale * fieldFx.shake).toFixed(2)) : 0;
      if (!view.field && rinkWrap) {
        const nextTranslate = fieldFx.shake ? `${fieldFx.shakeX}px ${fieldFx.shakeY}px` : '';
        if (fieldFx._lastTranslate !== nextTranslate) {
          fieldFx._lastTranslate = nextTranslate;
          rinkWrap.style.translate = nextTranslate;
        }
      }
      fieldFx.ballFlare = Math.max(0, fieldFx.ballFlare - dt / .8);
      if (fieldFx.fireWarp && (fieldFx.fireWarp.life -= dt) <= 0) fieldFx.fireWarp = null;
      if (fieldFx.koWarp && (fieldFx.koWarp.life -= dt) <= 0) fieldFx.koWarp = null;
      fieldFx.kickoffGlow = Math.max(0, fieldFx.kickoffGlow - dt / 1.5);
      if (fieldFx.goalSweep && (fieldFx.goalSweep.p += dt / 1.5) >= 1) fieldFx.goalSweep = null;
      if (fieldFx.goalCall && (fieldFx.goalCall.t += dt) >= GOAL_CALL_SECONDS) fieldFx.goalCall = null;
    }

    function addWallEffect(body, velocity, wallType, nx, ny) {
      if (isReducedMotion()) return;
      const fx = getEffects();
      const x = body.x + nx * body.radius, y = body.y + ny * body.radius;
      if (wallType === 'post') {
        const px = x < 500 ? 60 : 940, py = y < 300 ? 230 : 370;
        if (fx.pings.length < 12) {
          fx.pings.push({
            x: px, y: py, nx, ny,
            amp: Math.min(1, Math.max(0.25, velocity / 520)),
            spin: body.omega || 0,
            life: .46, duration: .46
          });
        }
      } else if ((wallType === 'net' || velocity > 220 || (body.team === -1 && Boolean(P.ballOnFire?.(body)) && velocity >= 60)) && fx.ripples.length < 24) {
        const net = wallType === 'net';
        const isMeteor = !net && body.team === -1 && Boolean(P.ballOnFire?.(body));
        const half = (net ? (velocity > 360 ? 42 : 30) : (isMeteor ? 72 : 60)) / WALL_STEP;
        let best = null;
        for (const run of net ? NET_RUNS : BOARD_RUNS) run.forEach((p, k) => {
          const d = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (!best || d < best.d) best = { d, run, k };
        });
        if (best) {
          fx.ripples.push({
            run: best.run,
            lo: Math.max(0, best.k - half),
            hi: Math.min(best.run.length - 1, best.k + half),
            net,
            meteor: isMeteor,
            x, y, nx, ny,
            side: x < 500 ? 0 : 1,
            amp: Math.min(net || isMeteor ? 1.25 : 1, velocity / (isMeteor ? 440 : 500)),
            life: isMeteor ? .72 : .6,
            duration: isMeteor ? .72 : .6
          });
          if (isMeteor) {
            const poofX = x - nx * (body.radius * 0.45);
            const poofY = y - ny * (body.radius * 0.45);
            fx.burns.push({ poof: true, x: poofX, y: poofY, radius: 30, age: 0 });
            if (fx.burns.length > 30) fx.burns.shift();
          }
        }
      }
    }

    function popup(body, text) {
      const popups = getEffects().popups;
      if (popups.length < 8) popups.push({ x: body.x, y: body.y - body.radius - 20, text, team: body.team, life: 1.2, duration: 1.2 });
    }

    function rounded(x, y, width, height, radius) {
      const ctx = getView().ctx;
      ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
    }
    function line(x1, y1, x2, y2, color, width = 2) {
      const ctx = getView().ctx;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    }
    function circle(x, y, r, color, width = 2) {
      const ctx = getView().ctx;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    }
    function inRink(paint) {
      const ctx = getView().ctx;
      ctx.save(); rounded(60, 60, 880, 480, 100); ctx.clip(); paint(); ctx.restore();
    }
    function badgePoint(b) {
      return getView().portrait ? { x: b.x - b.radius * .65, y: b.y - b.radius * .65 } : { x: b.x - b.radius * .65, y: b.y + b.radius * .65 };
    }

    function ribbon(points, widthAt, prevPoint = null) {
      if (!points || points.length < 2) return;
      const ctx = getView().ctx, left = [], right = [];
      for (let k = 0; k < points.length; k++) {
        const p = points[k];
        const a = k === 0 && prevPoint ? prevPoint : points[Math.max(0, k - 1)];
        const b = k === 0 && prevPoint ? p : points[Math.min(points.length - 1, k + 1)];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, half = widthAt(p) / 2;
        left.push([p.x + nx * half, p.y + ny * half]); right.push([p.x - nx * half, p.y - ny * half]);
      }
      ctx.beginPath(); ctx.moveTo(left[0][0], left[0][1]);
      for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath(); ctx.fill();
    }

    function softRibbon(points, widthAt, blur, color, prevPoint = null) {
      if (!points || points.length < 2) return;
      const ctx = getView().ctx;
      ctx.save();
      ctx.fillStyle = color;
      if (bench?.flags.noIceShadow || blur <= 0.05) {
        ribbon(points, widthAt, prevPoint);
      } else {
        const baseAlpha = ctx.globalAlpha;
        ctx.globalAlpha = baseAlpha * 0.22;
        ribbon(points, p => widthAt(p) + blur * 1.35, prevPoint);
        ctx.globalAlpha = baseAlpha * 0.34;
        ribbon(points, p => widthAt(p) + blur * 0.6, prevPoint);
        ctx.globalAlpha = baseAlpha * 0.44;
        ribbon(points, widthAt, prevPoint);
      }
      ctx.restore();
    }

    function cachedLayer(cache, key, paint, scale = 1) {
      const view = getView();
      if (cache.key !== key) {
        const width = Math.max(1, Math.round(view.canvas.width * scale)), height = Math.max(1, Math.round(view.canvas.height * scale)), main = view.ctx;
        cache.layer ||= doc.createElement('canvas');
        if (cache.layer.width !== width || cache.layer.height !== height) { cache.layer.width = width; cache.layer.height = height; }
        view.ctx = cache.layer.getContext('2d');
        view.ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); view.ctx.clearRect(0, 0, 1000, 600);
        view.ctx.save();
        try { paint(); } finally { view.ctx.restore(); view.ctx = main; }
        cache.key = key;
      }
      view.ctx.drawImage(cache.layer, 0, 0, 1000, 600);
    }

    function paintSkidSlice(ctx, s, points, prevPoint = null) {
      if (!points || points.length < 2) return;
      const age = Math.floor(s.age * 4) / 4;
      const t = age / SKID_LIFE, fade = 1 - t * t * (3 - 2 * t), thin = .6 + .4 * fade;
      if (fade <= 0.005) return;
      ctx.globalAlpha = .12 * fade;
      softRibbon(points, p => s.width * .7 * (.4 + .6 * p.depth) * thin, s.width * .45, '#000000', prevPoint);
      ctx.globalAlpha = .08 * fade;
      softRibbon(points, p => s.width * .3 * p.depth * thin, s.width * .2, '#000000', prevPoint);
    }

    function paintBurnPoof(ctx, s) {
      const age = Math.floor(s.age * 4) / 4;
      const t = age / BURN_LIFE, fade = 1 - t * t * (3 - 2 * t);
      if (fade <= 0.01) return;
      const r = s.radius || 30;
      ctx.save();
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      grad.addColorStop(0, `rgba(0, 0, 0, ${(0.82 * fade).toFixed(3)})`);
      grad.addColorStop(0.35, `rgba(12, 5, 2, ${(0.75 * fade).toFixed(3)})`);
      grad.addColorStop(0.65, `rgba(45, 18, 6, ${(0.55 * fade).toFixed(3)})`);
      grad.addColorStop(0.85, `rgba(45, 18, 6, ${(0.25 * fade).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(45, 18, 6, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function paintBurnSlice(ctx, s, points, prevPoint = null) {
      if (!points || points.length < 2) return;
      const age = Math.floor(s.age * 4) / 4;
      const t = age / BURN_LIFE, fade = 1 - t * t * (3 - 2 * t);
      if (fade <= 0.005) return;
      ctx.globalAlpha = .3 * fade;
      softRibbon(points, p => s.width * (.5 + .5 * p.depth), s.width * .35, '#2b1206', prevPoint);
      ctx.globalAlpha = .22 * fade;
      softRibbon(points, p => s.width * .35 * p.depth, s.width * .15, '#000000', prevPoint);
    }

    function paintIce() {
      const fx = getEffects(), ctx = getView().ctx;
      inRink(() => {
        for (const s of fx.skids) paintSkidSlice(ctx, s, s.points, null);
        for (const s of fx.burns) {
          if (s.poof) paintBurnPoof(ctx, s);
          else paintBurnSlice(ctx, s, s.points, null);
        }
      });
    }

    function drawIceLayer(cache, fx, scale) {
      const view = getView();
      const width = Math.max(1, Math.round(view.canvas.width * scale));
      const height = Math.max(1, Math.round(view.canvas.height * scale));
      const shadowFlag = Boolean(bench?.flags.noIceShadow);
      cache.layer ||= doc.createElement('canvas');
      const resized = cache.layer.width !== width || cache.layer.height !== height || cache.shadowFlag !== shadowFlag;
      const skidSnap = cache.skidSnap, burnSnap = cache.burnSnap;
      let canAppend = !resized && Array.isArray(skidSnap) && Array.isArray(burnSnap)
        && fx.skids.length >= skidSnap.length && fx.burns.length >= burnSnap.length;
      if (canAppend) {
        for (let i = 0; i < skidSnap.length; i++) {
          const prev = skidSnap[i], cur = fx.skids[i];
          if (cur !== prev.ref || Math.floor(cur.age * 4) !== prev.bucket || cur.points.length < prev.count) {
            canAppend = false;
            break;
          }
        }
      }
      if (canAppend) {
        for (let i = 0; i < burnSnap.length; i++) {
          const prev = burnSnap[i], cur = fx.burns[i];
          const curCount = cur.poof ? 1 : (cur.points?.length || 0);
          if (cur !== prev.ref || Math.floor(cur.age * 4) !== prev.bucket || curCount < prev.count) {
            canAppend = false;
            break;
          }
        }
      }
      if (!canAppend) {
        if (cache.layer.width !== width || cache.layer.height !== height) {
          cache.layer.width = width;
          cache.layer.height = height;
        }
        cache.shadowFlag = shadowFlag;
        const main = view.ctx;
        view.ctx = cache.layer.getContext('2d');
        view.ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0);
        view.ctx.clearRect(0, 0, 1000, 600);
        view.ctx.save();
        try { paintIce(); } finally { view.ctx.restore(); view.ctx = main; }
        cache.skidSnap = fx.skids.map(s => ({ ref: s, bucket: Math.floor(s.age * 4), count: s.points.length }));
        cache.burnSnap = fx.burns.map(s => ({ ref: s, bucket: Math.floor(s.age * 4), count: s.poof ? 1 : (s.points?.length || 0) }));
        cache.rebuilds = (cache.rebuilds || 0) + 1;
      } else {
        let hasDelta = fx.skids.length > skidSnap.length || fx.burns.length > burnSnap.length;
        if (!hasDelta) {
          for (let i = 0; i < skidSnap.length; i++) {
            if (fx.skids[i].points.length > skidSnap[i].count) { hasDelta = true; break; }
          }
        }
        if (!hasDelta) {
          for (let i = 0; i < burnSnap.length; i++) {
            const c = fx.burns[i].poof ? 1 : (fx.burns[i].points?.length || 0);
            if (c > burnSnap[i].count) { hasDelta = true; break; }
          }
        }
        if (hasDelta) {
          const main = view.ctx;
          view.ctx = cache.layer.getContext('2d');
          view.ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0);
          view.ctx.save();
          try {
            const lctx = view.ctx;
            inRink(() => {
              for (let i = 0; i < fx.skids.length; i++) {
                const s = fx.skids[i], prevCount = i < skidSnap.length ? skidSnap[i].count : 0;
                if (s.points.length > prevCount && s.points.length >= 2) {
                  if (prevCount < 2) paintSkidSlice(lctx, s, s.points, null);
                  else paintSkidSlice(lctx, s, s.points.slice(prevCount - 1), s.points[prevCount - 2]);
                }
                if (i < skidSnap.length) skidSnap[i].count = s.points.length;
                else skidSnap.push({ ref: s, bucket: Math.floor(s.age * 4), count: s.points.length });
              }
              for (let i = 0; i < fx.burns.length; i++) {
                const s = fx.burns[i], prevCount = i < burnSnap.length ? burnSnap[i].count : 0;
                if (s.poof) {
                  if (prevCount === 0) paintBurnPoof(lctx, s);
                  if (i < burnSnap.length) burnSnap[i].count = 1;
                  else burnSnap.push({ ref: s, bucket: Math.floor(s.age * 4), count: 1 });
                } else {
                  const len = s.points?.length || 0;
                  if (len > prevCount && len >= 2) {
                    if (prevCount < 2) paintBurnSlice(lctx, s, s.points, null);
                    else paintBurnSlice(lctx, s, s.points.slice(prevCount - 1), s.points[prevCount - 2]);
                  }
                  if (i < burnSnap.length) burnSnap[i].count = len;
                  else burnSnap.push({ ref: s, bucket: Math.floor(s.age * 4), count: len });
                }
              }
            });
          } finally {
            view.ctx.restore();
            view.ctx = main;
          }
          cache.appends = (cache.appends || 0) + 1;
        }
      }
      view.ctx.drawImage(cache.layer, 0, 0, 1000, 600);
    }

    function drawFieldUnder(colors) {
      const { primary, home, away } = colors, fx = getEffects(), view = getView(), ctx = view.ctx;
      const noBlur = Boolean(bench?.flags.noGlowBlur);
      if (fx.kickoffGlow) {
        ctx.save(); ctx.globalAlpha = fx.kickoffGlow; ctx.shadowColor = primary; ctx.shadowBlur = noBlur ? 0 : 12 * view.canvas.width / 1000;
        circle(500, 300, 70 + (1 - fx.kickoffGlow) * 10, primary, 3); ctx.restore();
      }
      if (fx.skids.length || fx.burns.length) {
        const scale = Math.min(1, 1000 / view.canvas.width);
        if (bench?.flags.freezeIceKey) {
          let key = view.canvas.width + ',' + view.canvas.height;
          for (const s of fx.skids) key += ',' + Math.floor(s.age * 4) + ':' + (s.points.length >> 3);
          key += '|';
          for (const s of fx.burns) key += ',' + Math.floor(s.age * 4) + ':' + (s.poof ? 'p' + Math.round(s.x) + '_' + Math.round(s.y) : ((s.points?.length || 0) >> 3));
          cachedLayer(fx.iceCache, key, paintIce, scale);
        } else {
          drawIceLayer(fx.iceCache, fx, scale);
        }
      }
      if (getPhase() === 'plan' && pulseMode() && !P.settled(view.bodies)) {
        inRink(() => { ctx.fillStyle = 'rgba(120,170,255,.07)'; ctx.fillRect(60, 60, 880, 480); });
      }
      fx.danger.forEach((glow, side) => {
        if (glow < .02) return;
        const x = side ? 940 : 60, color = side ? away : home;
        ctx.save(); ctx.globalAlpha = Math.min(1, glow) * .4; ctx.shadowColor = color; ctx.shadowBlur = noBlur ? 0 : 8 * glow * view.canvas.width / 1000;
        line(x, 230, x, 370, color, 5); ctx.restore();
      });
    }

    function drawGoalSweep(sweep, color) {
      const view = getView(), ctx = view.ctx;
      const p = sweep.p, x = sweep.team ? 60 + p * 880 : 940 - p * 880;
      const dim = 0.14 * Math.sin(Math.PI * p);
      const scorer = getScoringPlayer();
      inRink(() => {
        if (dim > 0.005) {
          ctx.fillStyle = `rgba(8, 10, 14, ${dim.toFixed(3)})`;
          ctx.fillRect(60, 60, 880, 480);
        }
        ctx.fillStyle = hexToRgba(color, .12 * Math.sin(Math.PI * p)); ctx.fillRect(60, 60, 880, 480);
        const band = ctx.createLinearGradient(x - 220, 0, x + 220, 0);
        band.addColorStop(0, hexToRgba(color, 0)); band.addColorStop(.4, hexToRgba(color, .32));
        band.addColorStop(.5, 'rgba(255,255,255,.5)'); band.addColorStop(.6, hexToRgba(color, .32)); band.addColorStop(1, hexToRgba(color, 0));
        ctx.globalAlpha = 1 - p * .6; ctx.fillStyle = band; ctx.fillRect(60, 60, 880, 480);
        if (scorer && scorer.x != null && scorer.y != null) {
          const spotR = (scorer.radius || 25) * 3.8;
          const spot = ctx.createRadialGradient(scorer.x, scorer.y, (scorer.radius || 25) * 0.4, scorer.x, scorer.y, spotR);
          spot.addColorStop(0, hexToRgba(color, 0.28 * (1 - p * 0.7)));
          spot.addColorStop(0.55, hexToRgba(color, 0.11 * (1 - p * 0.7)));
          spot.addColorStop(1, hexToRgba(color, 0));
          ctx.globalAlpha = 1;
          ctx.fillStyle = spot;
          ctx.beginPath();
          ctx.arc(scorer.x, scorer.y, spotR, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      const fx = getEffects(), mouth = sweep.team ? 60 : 940, back = sweep.team ? mouth - P.rink.goalDepth : mouth + P.rink.goalDepth;
      const pxW = view.canvas.width || 1000, pxScale = Math.max(0.5, Math.min(4, pxW / 1000));
      const sweepKey = `${sweep.team}\0${color}\0${pxW}`;
      let sweepSprite = fx.goalSweepCache?.key === sweepKey ? fx.goalSweepCache : null;
      if (!sweepSprite && doc?.createElement && typeof ctx.drawImage === 'function') {
        const sc = doc.createElement('canvas');
        const sctx = sc?.getContext?.('2d');
        if (sctx && typeof sctx.stroke === 'function') {
          const pad = 64, minX = Math.min(mouth, back) - pad, minY = 230 - pad;
          const lw = Math.abs(back - mouth) + pad * 2, lh = 140 + pad * 2;
          sc.width = Math.max(1, Math.ceil(lw * pxScale));
          sc.height = Math.max(1, Math.ceil(lh * pxScale));
          sctx.setTransform(pxScale, 0, 0, pxScale, -minX * pxScale, -minY * pxScale);
          sctx.lineCap = 'round';
          sctx.shadowColor = color; sctx.shadowBlur = 24 * pxScale;
          const seg = (x1, y1, x2, y2, stroke, w) => {
            sctx.beginPath(); sctx.moveTo(x1, y1); sctx.lineTo(x2, y2);
            sctx.strokeStyle = stroke; sctx.lineWidth = w; sctx.stroke();
          };
          seg(mouth, 230, back, 230, color, 6);
          seg(back, 230, back, 370, color, 6);
          seg(mouth, 370, back, 370, color, 6);
          seg(mouth, 230, mouth, 370, '#ffffff', 3);
          sweepSprite = fx.goalSweepCache = { key: sweepKey, canvas: sc, minX, minY, lw, lh };
        }
      }
      ctx.save(); ctx.globalAlpha = 1 - p;
      if (sweepSprite) {
        ctx.drawImage(sweepSprite.canvas, sweepSprite.minX, sweepSprite.minY, sweepSprite.lw, sweepSprite.lh);
      } else {
        ctx.shadowColor = color; ctx.shadowBlur = 24 * pxW / 1000;
        line(mouth, 230, back, 230, color, 6); line(back, 230, back, 370, color, 6); line(mouth, 370, back, 370, color, 6);
        line(mouth, 230, mouth, 370, '#ffffff', 3);
      }
      ctx.restore();
    }

    const skaterStyleCache = new WeakMap();

    function drawGoalCall(call, color) {
      const view = getView(), fx = getEffects(), badgeCtx = view.badgeCtx, skaters = getSkaters();
      const pop = isReducedMotion() ? 1 : Math.min(1, call.t / .27), scale = 1 + 2.70158 * (pop - 1) ** 3 + 1.70158 * (pop - 1) ** 2;
      const skaterNode = skaters[call.scorer] || null;
      const face = call._skater === skaterNode && call._face !== undefined ? call._face : (call._skater = skaterNode, call._face = skaterNode?.querySelector?.('canvas') || null);
      const top = face ? 40 : 0;
      const callLabel = view.anonymous && call.scorer < 0 && call.label.endsWith(' WINS!') && ububallReplay?.ANONYMOUS
        ? `${ububallReplay.ANONYMOUS[call.team].toUpperCase()} WINS!`
        : call.label;
      const callName = view.anonymous && call.scorer >= 0 ? anonymousName(call.scorer) : call.name;
      const pxW = view.canvas.width || 1000, pxScale = Math.max(0.5, Math.min(4, pxW / 1000));
      const paintBadge = (targetCtx, blurPx) => {
        const write = (text, y, size) => {
          targetCtx.font = `900 ${size}px system-ui, sans-serif`; targetCtx.lineWidth = size / 14; targetCtx.strokeStyle = color;
          targetCtx.strokeText(text, 0, y); targetCtx.fillStyle = '#ffffff'; targetCtx.fillText(text, 0, y);
        };
        targetCtx.shadowColor = color; targetCtx.shadowBlur = blurPx;
        if (face) {
          targetCtx.beginPath(); targetCtx.arc(0, -82, 74, 0, Math.PI * 2); targetCtx.fillStyle = color; targetCtx.fill();
          targetCtx.shadowBlur = 0; targetCtx.drawImage(face, -66, -148, 132, 132);
          targetCtx.shadowBlur = blurPx;
        }
        targetCtx.textAlign = 'center'; targetCtx.textBaseline = 'middle';
        write(callLabel, top, 88);
        if (callName) write(callName, top + 66, 34);
      };
      const cacheKey = `${callLabel}\0${callName}\0${color}\0${pxW}`;
      let cache = fx.goalCallCache?.key === cacheKey && fx.goalCallCache.face === face ? fx.goalCallCache : null;
      if (!cache && doc?.createElement && typeof badgeCtx.drawImage === 'function') {
        const sc = doc.createElement('canvas');
        const sctx = sc?.getContext?.('2d');
        if (sctx && typeof sctx.fillText === 'function') {
          sctx.font = '900 88px system-ui, sans-serif';
          const labelW = typeof sctx.measureText === 'function' ? (sctx.measureText(callLabel)?.width || 560) : 560;
          sctx.font = '900 34px system-ui, sans-serif';
          const nameW = callName ? (typeof sctx.measureText === 'function' ? (sctx.measureText(callName)?.width || 360) : 360) : 0;
          const halfW = Math.ceil(Math.max(150, labelW / 2, nameW / 2) + 76);
          const topExt = face ? 232 : 124;
          const botExt = (callName ? top + 92 : top + 58) + 76;
          const logicalW = halfW * 2, logicalH = topExt + botExt;
          sc.width = Math.max(1, Math.ceil(logicalW * pxScale));
          sc.height = Math.max(1, Math.ceil(logicalH * pxScale));
          sctx.setTransform(pxScale, 0, 0, pxScale, halfW * pxScale, topExt * pxScale);
          paintBadge(sctx, 30 * pxScale);
          cache = fx.goalCallCache = { key: cacheKey, face, canvas: sc, halfW, topExt, logicalW, logicalH };
        }
      }
      badgeCtx.save(); badgeCtx.translate(500, 300); if (view.portrait) badgeCtx.rotate(Math.PI / 2); badgeCtx.scale(scale, scale);
      badgeCtx.globalAlpha = Math.max(0, Math.min(1, (GOAL_CALL_SECONDS - call.t) / .5));
      if (cache) badgeCtx.drawImage(cache.canvas, -cache.halfW, -cache.topExt, cache.logicalW, cache.logicalH);
      else paintBadge(badgeCtx, 30 * pxW / 1000);
      badgeCtx.restore();
    }

    function drawFieldOver(colors) {
      const { border, text, home, away } = colors, fx = getEffects(), view = getView(), ctx = view.ctx;
      for (const r of fx.ripples) {
        const p = 1 - r.life / r.duration;
        const baseScale = r.goalPocket ? 13 : (r.net ? 9.5 : 8);
        const freq = r.goalPocket ? 4.2 : 5;
        const bulge = r.amp * baseScale * (1 - p) * Math.cos(p * Math.PI * freq);
        ctx.save();
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let k = r.lo; k <= r.hi; k++) {
          const w = r.run[k], d = bulge * Math.sin(Math.PI * (k - r.lo) / Math.max(1, r.hi - r.lo)) ** (r.goalPocket ? 1.4 : 2);
          ctx.lineTo(w.x + w.nx * d, w.y + w.ny * d);
        }
        const netColor = r.side ? away : home;
        ctx.globalAlpha = (1 - p) * .9;
        ctx.strokeStyle = r.net ? netColor : border;
        ctx.lineWidth = r.goalPocket ? 5.2 : 4;
        ctx.stroke();
        if (r.goalPocket && p < 0.65) {
          ctx.globalAlpha = (1 - p / 0.65) * 0.65;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (r.meteor && r.x != null && r.y != null) {
          // Hot glow centered strictly on the impact site
          const glowFade = (1 - p) ** 1.35;
          if (glowFade > 0.01) {
            ctx.save();
            const glowR = 26 * (0.8 + 0.35 * (1 - glowFade));
            const grad = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, glowR);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.25, '#fff3b0');
            grad.addColorStop(0.55, '#ff7a1a');
            grad.addColorStop(0.85, 'rgba(255, 84, 0, 0.45)');
            grad.addColorStop(1, 'rgba(255, 84, 0, 0)');
            ctx.globalAlpha = glowFade * 0.88;
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(r.x, r.y, glowR, 0, Math.PI * 2);
            ctx.fill();
            // Intense core flash at impact point
            ctx.globalAlpha = glowFade * 0.95;
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(r.x, r.y, 6.5 * glowFade, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
        ctx.restore();
      }
      for (const g of fx.pings) {
        const p = 1 - g.life / g.duration;
        const fade = (1 - p) ** 1.15;
        const amp = g.amp ?? 0.7;
        const shiver = (1 - p) ** 1.6 * Math.sin(p * Math.PI * 18) * (2.6 * amp);
        const sx = g.x + (g.nx || 0) * shiver * 0.5 - (g.ny || 0) * shiver;
        const sy = g.y + (g.ny || 0) * shiver * 0.5 + (g.nx || 0) * shiver;
        ctx.save();
        ctx.globalAlpha = fade;
        circle(g.x, g.y, 4 + p * (18 + 6 * amp), text, 2.2);
        if (amp > 0.45) {
          ctx.globalAlpha = fade * 0.72;
          circle(g.x, g.y, 6 + p * (28 + 8 * amp), '#ffd76b', 1.6);
        }
        if (Math.abs(g.spin || 0) >= 6 && fade > 0.15) {
          const spinDir = Math.sign(g.spin) || 1;
          const spinPow = Math.min(1, Math.abs(g.spin) / 20);
          const rot = p * spinDir * 4.2;
          fillTaperedSpinArc(ctx, g.x, g.y, 8 + p * 18, rot, 1.45 * spinDir, 2.2 + 1.2 * spinPow, '#ffd76b', fade * 0.85);
          fillTaperedSpinArc(ctx, g.x, g.y, 8 + p * 18, rot + Math.PI, 1.45 * spinDir, 2.2 + 1.2 * spinPow, '#ffffff', fade * 0.75);
        }
        ctx.globalAlpha = fade;
        ctx.fillStyle = p < 0.35 ? '#ffd76b' : text;
        ctx.beginPath();
        ctx.arc(sx, sy, (3.6 + 1.4 * amp) * (1 - p * 0.65) + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (fx.goalSweep) drawGoalSweep(fx.goalSweep, fx.goalSweep.team ? away : home);
      if (fx.goalCall) drawGoalCall(fx.goalCall, fx.goalCall.team ? away : home);
      if (pulseMode() && !getGoalReplay() && !isCardShot()) {
        const turnSeconds = ububallMatch.turnTicks(view.mode) * P.DT;
        const activeReplay = getActivePlayback() || getTheater();
        const online = getOnline(), onlineReplay = getOnlineReplay();
        const progress = activeReplay ? activeReplay.tick * P.DT / turnSeconds
          : getPhase() !== 'play' ? 0
          : online?.active ? (onlineReplay?.currentTick ?? 0) * P.DT / turnSeconds
          : getElapsed() / turnSeconds;
        ctx.save(); ctx.lineCap = 'round';
        ctx.globalAlpha = .25; line(160, 556, 840, 556, border, 4);
        if (progress > 0) { ctx.globalAlpha = .9; line(160, 556, 160 + 680 * Math.min(1, progress), 556, '#DA4DB5', 4); }
        ctx.restore();
      }
    }

    function isCreasing(b, team) {
      const view = getView();
      const i = view.bodies.indexOf(b);
      const activePlans = getActivePlayback()?.plans ?? getPlans();
      const plan = getPhase() === 'plan' && i >= 0 ? activePlans[i] : null;
      const stalwartArmed = Boolean(plan?.superArm || b.superArm) && (b.meter ?? 0) >= 100 && (b.equippedSuper?.key === 'stalwart' || b.superKey === 'stalwart');
      if (b.superActive === 'stalwart' || stalwartArmed) return false;
      return ububallMatch.inCrease(P, b, team);
    }

    const stalling = (fieldFouls = getFouls()) => fieldFouls.corner !== null && fieldFouls.cornerTurns >= ububallMatch.FOULS.stallTurns;

    function cornerTeams(fieldFouls = getFouls()) {
      const inside = getView().bodies.slice(0, 6).filter(b => ububallMatch.cornerOf(P, b.x, b.y, b.radius) === fieldFouls.corner);
      return [0, 1].map(team => inside.filter(b => b.team === team));
    }

    function offenders(fieldFouls = getFouls()) {
      const list = getView().bodies.slice(0, 6).filter(b => fieldFouls.crease[b.team] && isCreasing(b, b.team));
      if (stalling(fieldFouls)) {
        const [home, away] = cornerTeams(fieldFouls);
        if (home.length !== away.length) list.push(...(home.length > away.length ? home : away).filter(b => !list.includes(b)));
      }
      return list;
    }

    const foulsShowing = () => {
      const f = getFouls();
      return f.crease[0] || f.crease[1] || stalling(f) || getView().bodies.some(b => b.carded);
    };

    function drawAlert(x, y, size, alpha = 1) {
      const view = getView(), badgeCtx = view.badgeCtx;
      badgeCtx.save(); badgeCtx.translate(x, y); if (view.portrait) badgeCtx.rotate(Math.PI / 2);
      badgeCtx.globalAlpha = alpha; badgeCtx.scale(size / 24, size / 24); badgeCtx.translate(-12, -12);
      badgeCtx.fillStyle = '#0b0d10d9'; badgeCtx.fill(ALERT);
      badgeCtx.lineWidth = 2; badgeCtx.lineCap = badgeCtx.lineJoin = 'round'; badgeCtx.strokeStyle = '#ffb020'; badgeCtx.stroke(ALERT);
      badgeCtx.restore();
    }

    function drawCheck(x, y, size) {
      const view = getView(), badgeCtx = view.badgeCtx;
      badgeCtx.save(); badgeCtx.translate(x, y); if (view.portrait) badgeCtx.rotate(Math.PI / 2);
      badgeCtx.scale(size / 24, size / 24);
      badgeCtx.beginPath(); badgeCtx.arc(0, 0, 12, 0, Math.PI * 2); badgeCtx.fillStyle = '#0b0d10d9'; badgeCtx.fill();
      badgeCtx.translate(-12, -12); badgeCtx.scale(.8, .8); badgeCtx.translate(3, 3);
      badgeCtx.lineWidth = 3; badgeCtx.lineCap = badgeCtx.lineJoin = 'round'; badgeCtx.strokeStyle = '#3ddc84'; badgeCtx.stroke(CHECK);
      badgeCtx.restore();
    }

    function drawFieldWarning(x, y, words, color, cleared = false) {
      const view = getView(), badgeCtx = view.badgeCtx;
      if (cleared) drawCheck(view.portrait ? x + 13 : x, view.portrait ? y : y - 13, 24);
      else drawAlert(view.portrait ? x + 13 : x, view.portrait ? y : y - 13, 24);
      badgeCtx.save(); badgeCtx.translate(x, y); if (view.portrait) badgeCtx.rotate(Math.PI / 2);
      badgeCtx.font = '700 11px system-ui, sans-serif'; badgeCtx.textAlign = 'center'; badgeCtx.textBaseline = 'middle'; badgeCtx.fillStyle = color;
      words.forEach((word, i) => badgeCtx.fillText(word, 0, 7 + i * 12));
      badgeCtx.restore();
    }

    function drawCard(b) {
      const view = getView(), badgeCtx = view.badgeCtx, r = b.radius * .7;
      badgeCtx.save(); badgeCtx.translate(b.x + r, view.portrait ? b.y + r : b.y - r); badgeCtx.rotate((view.portrait ? Math.PI / 2 : 0) + .2);
      badgeCtx.beginPath(); badgeCtx.roundRect(-6, -8, 12, 16, 2); badgeCtx.fillStyle = '#ffd60a'; badgeCtx.fill();
      badgeCtx.lineWidth = 1.5; badgeCtx.strokeStyle = '#0b0d10'; badgeCtx.stroke();
      badgeCtx.restore();
    }

    function predictFouls(prediction) {
      const fouls = getFouls(), view = getView(), plans = getPlans();
      const result = { crease: [false, false], corner: false, left: new Set() };
      if (!fouls.crease[0] && !fouls.crease[1] && !stalling(fouls)) return result;
      const copy = structuredClone(fouls), samples = Math.max(...prediction.paths.map(path => path.length));
      const meta = view.bodies.map((b, i) => {
        const plan = plans[i];
        const stalwartArmed = Boolean(plan?.superArm || b.superArm) && (b.meter ?? 0) >= 100 && (b.equippedSuper?.key === 'stalwart' || b.superKey === 'stalwart');
        return {
          team: b.team,
          radius: b.radius,
          superActive: b.superActive === 'stalwart' || stalwartArmed ? 'stalwart' : b.superActive,
          wasCreasing: i < 6 && fouls.crease[b.team] && isCreasing(b, b.team)
        };
      });
      const field = meta.map(m => ({ team: m.team, radius: m.radius, x: 0, y: 0, superActive: m.superActive }));
      for (let k = 1; k < samples; k++) {
        for (let i = 0; i < field.length; i++) {
          const path = prediction.paths[i], at = path[Math.min(k, path.length - 1)];
          field[i].x = at.x; field[i].y = at.y;
        }
        ububallMatch.lapseFouls(P, field, copy);
        for (let i = 0; i < 6; i++) {
          if (meta[i].wasCreasing && !isCreasing(field[i], meta[i].team)) result.left.add(i);
        }
      }
      result.crease = [0, 1].map(team => fouls.crease[team] && !copy.crease[team]);
      result.corner = stalling(fouls) && copy.corner === null;
      return result;
    }

    function cornerWarningY(fieldFouls = getFouls()) {
      const view = getView();
      const visibleRinkHeight = getRenderSize ? (getRenderSize().visibleRinkHeight ?? 600) : 600;
      const inset = !view.portrait && !view.field && visibleRinkHeight < 600 ? 60 : 30;
      return fieldFouls.corner > 1 ? 600 - inset : inset;
    }

    function warningAt(p, fieldFouls = getFouls()) {
      const near = (x, y) => Math.abs(p.x - x) < 32 && Math.abs(p.y - y) < 34;
      for (const team of [0, 1]) if (fieldFouls.crease[team] && near(team ? 970 : 30, 180)) return { kind: 'crease', team };
      if (stalling(fieldFouls) && near(fieldFouls.corner % 2 ? 970 : 30, cornerWarningY(fieldFouls))) return { kind: 'corner' };
      return null;
    }

    let predictionCache = null, predictionRev = 0;
    const predictionLayer = {};
    function dirtyPrediction() { predictionRev++; }
    function getPredictionCache() { return predictionCache; }

    function predictionKey() {
      const view = getView(), fouls = getFouls(), plans = getPlans();
      const ball = view.bodies[6];
      let k = `${predictionRev}|${getTurn()}|${view.mode}|${fouls.crease[0] ? 1 : 0},${fouls.crease[1] ? 1 : 0}|${ball ? ball.x + ',' + ball.y : ''}`;
      for (let i = 0; i < 3; i++) {
        const p = plans[i], b = view.bodies[i];
        if (p) k += `|${p.angle},${p.power},${p.spin || 0},${p.guard ? 1 : 0},${b?.superArm || p.superArm ? 1 : 0},${b?.carded ? 1 : 0}`;
      }
      return k;
    }

    function strokeDecimatedPathRange(ctx, points, start, end) {
      if (end <= start) return;
      let lx = points[start].x, ly = points[start].y;
      let ux = 0, uy = 0, hasDir = false, segments = 0;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      for (let i = start + 1; i < end; i++) {
        const px = points[i].x, py = points[i].y;
        const dx = px - lx, dy = py - ly;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.01) continue;
        const nxPt = points[i + 1];
        const ndx = nxPt.x - px, ndy = nxPt.y - py;
        const nLen2 = ndx * ndx + ndy * ndy;
        const sharpTurn = nLen2 > 0.01 && (dx * ndx + dy * ndy) < 0.92 * Math.sqrt(d2 * nLen2);
        if (!sharpTurn) {
          if (d2 < 4) continue;
          if (hasDir && d2 < 1225) {
            const inv = 1 / Math.sqrt(d2);
            const dirX = dx * inv, dirY = dy * inv;
            const nextAligned = nLen2 < 0.01 || ((ndx * dirX + ndy * dirY) > 0.998 * Math.sqrt(nLen2));
            if ((ux * dirX + uy * dirY) > 0.9995 && nextAligned) continue;
          }
        }
        ctx.lineTo(px, py);
        const inv = 1 / Math.sqrt(d2);
        ux = dx * inv; uy = dy * inv; hasDir = true;
        lx = px; ly = py;
        segments++;
      }
      const ex = points[end].x, ey = points[end].y;
      if ((ex - lx) * (ex - lx) + (ey - ly) * (ey - ly) >= 0.01) {
        ctx.lineTo(ex, ey);
        segments++;
      }
      if (segments > 0) ctx.stroke();
    }

    function paintPrediction(prediction, home, away) {
      const view = getView(), ctx = view.ctx;
      prediction.paths.forEach((points, index) => {
        if (points.length < 2) return;
        const x0 = points[0].x, y0 = points[0].y;
        let moved = false;
        for (let i = 1; i < points.length; i++) {
          const dx = points[i].x - x0, dy = points[i].y - y0;
          if (dx * dx + dy * dy > 0.64) { moved = true; break; }
        }
        if (!moved) return;
        const isBall = view.bodies[index].team === -1;
        const color = isBall ? '#f2efe9' : view.bodies[index].team === 0 ? home : away;
        const baseAlpha = isBall ? .9 : .65;
        ctx.save();
        ctx.setLineDash(isBall ? [3, 4] : [4, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = isBall ? 2.5 : 2;

        let splitIdx = 0;
        while (splitIdx < points.length && prediction.horizon - points[splitIdx].tick >= 240) splitIdx++;
        const solidEnd = Math.min(points.length - 1, splitIdx);
        if (solidEnd >= 1) {
          ctx.globalAlpha = baseAlpha;
          strokeDecimatedPathRange(ctx, points, 0, solidEnd);
        }

        if (solidEnd < points.length - 1) {
          const remaining = points.length - 1 - solidEnd;
          const BUCKETS = 5, step = Math.ceil(remaining / BUCKETS);
          for (let b = 0; b < BUCKETS; b++) {
            const start = solidEnd + b * step;
            if (start >= points.length - 1) break;
            const end = Math.min(points.length - 1, start + step);
            const midTick = points[Math.floor((start + end) / 2)].tick;
            const fade = Math.max(0, Math.min(1, (prediction.horizon - midTick) / 240));
            ctx.globalAlpha = fade * baseAlpha;
            strokeDecimatedPathRange(ctx, points, start, end);
          }
        }
        ctx.restore();
      });

      const end = pulseMode() ? ububallMatch.turnTicks(view.mode) : 0;
      prediction.paths.forEach((points, index) => {
        const k = end ? points.findIndex(p => p.tick >= end) : -1;
        if (k < 1) return;
        const from = points[k - 1], to = points[k], dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
        if (!d) return;
        const t = (end - from.tick) / (to.tick - from.tick), x = from.x + dx * t, y = from.y + dy * t;
        const isBall = view.bodies[index].team === -1, half = isBall ? 6 : 8, nx = -dy / d * half, ny = dx / d * half;
        ctx.save(); ctx.globalAlpha = isBall ? .95 : .8;
        line(x - nx, y - ny, x + nx, y + ny, isBall ? '#f2efe9' : view.bodies[index].team === 0 ? home : away, 2.5);
        ctx.restore();
      });

      if (prediction.ignition) {
        const { x, y, team } = prediction.ignition;
        const ignitionColor = team === 1 ? away : home;
        ctx.save(); ctx.translate(x, y); if (view.portrait) ctx.rotate(Math.PI / 2);
        ctx.translate(-12, -12);
        ctx.globalAlpha = .95; ctx.fillStyle = ignitionColor; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.fill(IGNITION_FLAME); ctx.stroke(IGNITION_FLAME);
        ctx.restore();
      }
      if (prediction.goalTargets) {
        for (const target of prediction.goalTargets) {
          if (target.team >= 0 && !prediction.paths[target.index].some(p => Math.hypot(p.x - prediction.paths[target.index][0].x, p.y - prediction.paths[target.index][0].y) > 3)) continue;
          const isBall = target.team < 0;
          const color = isBall ? '#f2efe9' : target.team === 0 ? home : away;
          ctx.save();
          ctx.translate(target.x, target.y);
          if (view.portrait) ctx.rotate(Math.PI / 2);
          ctx.beginPath();
          ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(11, 13, 16, 0.75)';
          ctx.fill();
          ctx.scale(13 / 24, 13 / 24);
          ctx.translate(-12, -12);
          ctx.lineWidth = 1.8;
          ctx.lineCap = ctx.lineJoin = 'round';
          ctx.strokeStyle = color;
          ctx.stroke(TARGET_ICON);
          ctx.restore();
        }
      }
      for (const stop of prediction.stops) {
        if (!stop.stopped || !prediction.paths[stop.index].some(p => Math.hypot(p.x - stop.x, p.y - stop.y) > 3)) continue;
        if (prediction.goalTargets?.some(t => t.index === stop.index && Math.hypot(t.x - stop.x, t.y - stop.y) < 5)) continue;
        const color = view.bodies[stop.index].team < 0 ? '#fff' : view.bodies[stop.index].team === 0 ? home : away;
        line(stop.x - 4, stop.y - 4, stop.x + 4, stop.y + 4, color, 2);
        line(stop.x + 4, stop.y - 4, stop.x - 4, stop.y + 4, color, 2);
      }
      if (prediction.impacts && prediction.impacts.length > 0) {
        ctx.save(); rounded(60, 60, 880, 480, 100);
        ctx.rect(60 - P.rink.goalDepth, 230, P.rink.goalDepth, 140); ctx.rect(940, 230, P.rink.goalDepth, 140); ctx.clip();
        for (const hit of prediction.impacts) {
          const team = view.bodies[hit.index].team;
          const color = team < 0 ? '#ffffff' : team === 0 ? home : away;
          ctx.save();
          ctx.translate(hit.x, hit.y);
          if (view.portrait) ctx.rotate(Math.PI / 2);
          const fade = Math.min(1, (prediction.horizon - hit.tick) / 240);
          ctx.globalAlpha = .2 * fade;
          const size = hit.reach * 128 / 60;
          ctx.drawImage(impactStamp(color, doc), -size / 2, -size / 2, size, size);
          ctx.restore();
        }
        ctx.restore();
      }
    }

    function drawPrediction(home, away) {
      if (bench?.flags.noPredictAll) return;
      const view = getView(), key = predictionKey();
      const t0 = bench?.rec ? clockNow() : 0;
      if (predictionCache?.key !== key) {
        const data = P.predictTurn(view.bodies, getPlans());
        predictionCache = { key, data, fouls: predictFouls(data) };
      }
      const t1 = bench?.rec ? clockNow() : 0;
      if (!bench?.flags.noPredictLayer) {
        const layerKey = [view.canvas.width, view.canvas.height, home, away, view.portrait, view.mode, key].join();
        if (isDragging() || predictionLayer.lastSeenKey !== layerKey) {
          predictionLayer.lastSeenKey = layerKey;
          view.ctx.save();
          try { paintPrediction(predictionCache.data, home, away); } finally { view.ctx.restore(); }
        } else {
          cachedLayer(predictionLayer, layerKey, () => paintPrediction(predictionCache.data, home, away));
        }
      }
      if (bench?.rec) {
        bench.rec.predictSimMs += (t1 - t0);
        bench.rec.predictPaintMs += (clockNow() - t1);
      }
    }

    function drawPredictedGoalGlow(home, away) {
      if (bench?.flags.noPredictAll) return;
      const data = predictionCache?.data;
      if (!data || data.goal === null || data.goalTick == null) return;
      const view = getView(), ctx = view.ctx;
      const defendingSide = data.goal === 1 ? 0 : 1;
      const color = defendingSide === 0 ? home : away;

      const arrival = data.goalTick * P.DT;
      const horizon = (data.horizon || 480) * P.DT;
      const u = Math.max(0, Math.min(1, 1 - arrival / horizon));

      const freq = 1.2 + 4.3 * u;
      const now = clockNow() / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(now * Math.PI * 2 * freq);

      const baseAlpha = 0.25 + 0.15 * (1 - u);
      const peakAlpha = 0.45 + 0.55 * u;
      const alpha = baseAlpha + (peakAlpha - baseAlpha) * pulse;
      const blur = (8 + 20 * u * (0.6 + 0.4 * pulse)) * (view.canvas.width / 1000);

      const depth = P.rink.goalDepth;
      const mouthX = defendingSide ? 940 : 60;
      const backX = defendingSide ? 940 + depth : 60 - depth;
      const minX = Math.min(mouthX, backX);

      ctx.save();
      ctx.fillStyle = color;
      ctx.globalAlpha = (0.04 + 0.16 * u) * (0.6 + 0.4 * pulse);
      ctx.fillRect(minX, 230, depth, 140);

      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = bench?.flags.noGlowBlur ? 0 : blur;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.lineWidth = 4 + 3 * u;
      ctx.beginPath();
      ctx.moveTo(mouthX, 230);
      ctx.lineTo(backX, 230);
      ctx.lineTo(backX, 370);
      ctx.lineTo(mouthX, 370);
      ctx.stroke();

      ctx.lineWidth = 5 + 4 * u;
      line(mouthX, 230, mouthX, 370, color, 5 + 4 * u);
      ctx.restore();
    }

    function drawFouls(text, fieldFouls = getFouls()) {
      const view = getView();
      const predicted = getPhase() === 'plan' ? predictionCache?.fouls : null;
      for (const team of [0, 1]) if (fieldFouls.crease[team]) drawFieldWarning(team ? 970 : 30, 180, ['Goal', 'Camping'], text, predicted?.crease[team]);
      if (stalling(fieldFouls)) drawFieldWarning(fieldFouls.corner % 2 ? 970 : 30, cornerWarningY(fieldFouls), ['Corner', 'Stalling'], text, predicted?.corner);
      const flash = isReducedMotion() ? 1 : .35 + .65 * (.5 + .5 * Math.cos(clockNow() / 1000 * Math.PI * 2.4));
      const creasing = new Set(view.bodies.slice(0, 6).filter(b => fieldFouls.crease[b.team] && isCreasing(b, b.team)));
      for (const b of offenders(fieldFouls)) {
        if (b.carded) continue;
        const x = b.x + b.radius * .8, y = view.portrait ? b.y + b.radius * .8 : b.y - b.radius * .8;
        if (predicted && (creasing.has(b) ? predicted.left.has(view.bodies.indexOf(b)) : predicted.corner)) drawCheck(x, y, 24);
        else drawAlert(x, y, 26, flash);
      }
      for (const b of view.bodies.slice(0, 6)) if (b.carded) drawCard(b);
    }

    function drawFoulFocus(text) {
      const foulInfo = getFoulInfo();
      if (!foulInfo) return;
      const view = getView(), ctx = view.ctx, fouls = getFouls();
      const amber = '#ffb020', ring = (list, dashed) => list.forEach(b => {
        ctx.save(); if (dashed) ctx.setLineDash([4, 5]); circle(b.x, b.y, Math.max(b.radius, b.reach || b.radius) + 7, dashed ? text : amber, 2.5); ctx.restore();
      });
      const label = (words, x, y) => {
        ctx.save(); ctx.translate(x, y); if (view.portrait) ctx.rotate(Math.PI / 2);
        ctx.font = '800 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = '#101217'; ctx.strokeText(words, 0, 0); ctx.fillStyle = amber; ctx.fillText(words, 0, 0); ctx.restore();
      };
      const ubus = view.bodies.slice(0, 6);
      ctx.save();
      if (foulInfo.kind === 'crease') {
        const t = foulInfo.team, mouth = t ? 940 : 60, zone = ububallMatch.attackZoneLine(P, t), from = t ? Math.PI / 2 : -Math.PI / 2;
        inRink(() => { ctx.globalAlpha = .1; ctx.fillStyle = amber; ctx.fillRect(Math.min(mouth, zone), 60, Math.abs(zone - mouth), 480); });
        ctx.globalAlpha = .8; line(zone, 60, zone, 540, amber, 2);
        ctx.beginPath(); ctx.moveTo(mouth, 300); ctx.arc(mouth, 300, ububallMatch.FOULS.crease, from, from + Math.PI); ctx.closePath();
        ctx.globalAlpha = .22; ctx.fillStyle = amber; ctx.fill(); ctx.globalAlpha = .9; ctx.strokeStyle = amber; ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = 1;
        label('Attack zone', (mouth + zone) / 2, view.portrait ? 112 : 80);
        label('Crease', mouth + (t ? -40 : 40), 300 - ububallMatch.FOULS.crease - 16);
        ring(ubus.filter(b => b.team === t && isCreasing(b, t)), false);
        ring(ubus.filter(b => b.team === 1 - t && ububallMatch.inAttackZone(P, b, t)), true);
      } else {
        const c = fouls.corner ?? 0, x = c % 2 ? 840 : 60, y = c > 1 ? 440 : 60;
        inRink(() => { ctx.globalAlpha = .16; ctx.fillStyle = amber; ctx.fillRect(x, y, 100, 100); });
        ctx.globalAlpha = .8; ctx.setLineDash([6, 6]);
        line(c % 2 ? 840 : 160, y, c % 2 ? 840 : 160, y + 100, amber, 2); line(x, c > 1 ? 440 : 160, x + 100, c > 1 ? 440 : 160, amber, 2);
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        label('Corner', c % 2 ? 790 : 210, c > 1 ? 430 : 170);
        const [home, away] = cornerTeams(fouls);
        ring(home, home.length <= away.length); ring(away, away.length <= home.length);
      }
      ctx.restore();
    }

    function fillTaperedSpinArc(targetCtx, cx, cy, radius, startAngle, arcSweep, maxWidth, color, peakAlpha) {
      const steps = 18, dir = Math.sign(arcSweep) || 1, endAngle = startAngle + arcSweep;
      const outer = [], inner = [];
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const ang = startAngle + arcSweep * u;
        const tailRamp = Math.pow(u, 0.42);
        const noseTaper = u > 0.78 ? 1 - 0.58 * Math.pow((u - 0.78) / 0.22, 1.35) : 1;
        const half = maxWidth * 0.5 * tailRamp * noseTaper;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        outer.push([cx + ca * (radius + half), cy + sa * (radius + half)]);
        inner.push([cx + ca * (radius - half), cy + sa * (radius - half)]);
      }
      const tipAng = endAngle + dir * Math.min(0.06, (maxWidth * 0.48) / Math.max(14, radius));
      const tipX = cx + Math.cos(tipAng) * radius, tipY = cy + Math.sin(tipAng) * radius;
      const tailX = outer[0][0], tailY = outer[0][1];
      targetCtx.beginPath();
      targetCtx.moveTo(tailX, tailY);
      for (let s = 1; s <= steps; s++) targetCtx.lineTo(outer[s][0], outer[s][1]);
      targetCtx.lineTo(tipX, tipY);
      for (let s = steps; s >= 1; s--) targetCtx.lineTo(inner[s][0], inner[s][1]);
      targetCtx.closePath();
      if (Math.hypot(tipX - tailX, tipY - tailY) > 0.5) {
        const grad = targetCtx.createLinearGradient(tailX, tailY, tipX, tipY);
        grad.addColorStop(0, hexToRgba(color, peakAlpha * 0.10));
        grad.addColorStop(0.15, hexToRgba(color, peakAlpha * 0.55));
        grad.addColorStop(0.42, hexToRgba(color, peakAlpha * 0.84));
        grad.addColorStop(0.78, hexToRgba(color, peakAlpha * 0.96));
        grad.addColorStop(1, hexToRgba(color, peakAlpha));
        targetCtx.fillStyle = grad;
      } else {
        targetCtx.fillStyle = hexToRgba(color, peakAlpha);
      }
      targetCtx.fill();
    }

    function drawSpin(b, color) {
      const spin = Math.abs(b.omega);
      if (spin < 2.5 || isReducedMotion() || bench?.flags.noSpin) return;
      const ctx = getView().ctx;
      const power = Math.min(1, (spin - 2.5) / 20), arcs = spin >= 8 ? 3 : 2;
      const dir = Math.sign(b.omega);
      const sweep = (arcs === 3 ? (1.28 + 0.56 * power) : (1.42 + 0.95 * power)) * dir;
      ctx.save();
      for (let k = 0; k < arcs; k++) {
        const start = b.rotation + k * 2 * Math.PI / arcs;
        fillTaperedSpinArc(ctx, b.x, b.y, b.radius + 4.5, start, sweep, 1.65 + 2.15 * power, color, Math.min(0.96, 0.36 + 0.58 * power));
        if (power > 0.30) {
          fillTaperedSpinArc(ctx, b.x, b.y, b.radius + 9.8, start + sweep * 0.14, sweep * 0.84, 1.15 + 1.15 * power, color, Math.min(0.76, 0.22 + (power - 0.30) * 0.76));
        }
      }
      ctx.restore();
    }

    function drawTailgateCone(b, draft) {
      if (draft <= 0.22 || isReducedMotion()) return;
      const speed = Math.hypot(b.vx || 0, b.vy || 0);
      if (speed < (P.TAILGATE?.minSpeed ?? 110)) return;
      const ctx = getView().ctx;
      const heading = Math.atan2(b.vy, b.vx);
      const reachR = Math.max(b.radius, b.reach || b.radius, 18);
      const strength = Math.min(1, (draft - 0.22) / 0.72);
      const t = clockNow() / 1000, phaseShift = (b.playerIndex || 0) * 1.9;
      const flutter = Math.sin(t * 20 + phaseShift) * 1.2;
      const r = reachR + 4.5;
      const noseX = r + 13 + 7 * strength + flutter * 0.6;
      const backX = -r * 0.88;
      const wingY = r + 16 + 7 * strength + flutter * 0.9;

      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(heading);

      // 1. Translucent aerodynamic mach-cone shroud wrapping the front nose and flaring past the flanks
      ctx.beginPath();
      ctx.moveTo(noseX, 0);
      const coneSteps = 10;
      for (let s = 1; s <= coneSteps; s++) {
        const u = s / coneSteps;
        const x = noseX + (backX - noseX) * Math.pow(u, 0.94);
        const y = wingY * Math.pow(u, 0.72);
        ctx.lineTo(x, y);
      }
      ctx.arc(0, 0, r + 1.2, 2.32, -2.32, true);
      for (let s = coneSteps; s >= 1; s--) {
        const u = s / coneSteps;
        const x = noseX + (backX - noseX) * Math.pow(u, 0.94);
        const y = -wingY * Math.pow(u, 0.72);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      const shroudGrad = ctx.createLinearGradient(noseX, 0, backX, 0);
      shroudGrad.addColorStop(0, "rgba(210, 248, 255, " + (0.28 + 0.22 * strength).toFixed(3) + ")");
      shroudGrad.addColorStop(0.45, "rgba(170, 236, 255, " + (0.14 + 0.14 * strength).toFixed(3) + ")");
      shroudGrad.addColorStop(1, 'rgba(170, 236, 255, 0)');
      ctx.fillStyle = shroudGrad;
      ctx.fill();

      // 2. Crisp tapered V-cone bow streamlines parting from the nose tip around both sides
      const bladeGrad = ctx.createLinearGradient(noseX, 0, backX, 0);
      bladeGrad.addColorStop(0, "rgba(248, 254, 255, " + (0.65 + 0.3 * strength).toFixed(3) + ")");
      bladeGrad.addColorStop(0.5, "rgba(182, 240, 255, " + (0.36 + 0.24 * strength).toFixed(3) + ")");
      bladeGrad.addColorStop(1, 'rgba(182, 240, 255, 0)');
      ctx.fillStyle = bladeGrad;

      for (const sign of [-1, 1]) {
        const outerPts = [], innerPts = [];
        for (let s = 0; s <= coneSteps; s++) {
          const u = s / coneSteps;
          const x = noseX + (backX - noseX) * Math.pow(u, 0.94);
          const y = sign * wingY * Math.pow(u, 0.72);
          const w = (2.8 + 1.3 * strength) * (1 - u * 0.92) * (u < 0.1 ? 0.5 + 0.5 * (u / 0.1) : 1);
          outerPts.push([x + w * 0.2, y + sign * w * 0.5]);
          innerPts.push([x - w * 0.35, y - sign * w * 0.5]);
        }
        ctx.beginPath();
        ctx.moveTo(outerPts[0][0], outerPts[0][1]);
        for (let s = 1; s <= coneSteps; s++) ctx.lineTo(outerPts[s][0], outerPts[s][1]);
        for (let s = coneSteps; s >= 0; s--) ctx.lineTo(innerPts[s][0], innerPts[s][1]);
        ctx.closePath();
        ctx.fill();

        // Secondary inner airflow streamline skimming just outside the ubu's front ring
        const innerNoseX = r + 5.5 + 2.5 * strength - flutter * 0.4;
        const innerBackX = -r * 0.48;
        const innerWingY = r + 8.5 + 3 * strength;
        const iOut = [], iIn = [];
        for (let s = 0; s <= 7; s++) {
          const u = s / 7;
          const x = innerNoseX + (innerBackX - innerNoseX) * u;
          const y = sign * (2.5 + (innerWingY - 2.5) * Math.pow(u, 0.65));
          const w = (1.5 + 0.7 * strength) * (1 - u);
          iOut.push([x, y + sign * w * 0.5]);
          iIn.push([x, y - sign * w * 0.5]);
        }
        ctx.beginPath();
        ctx.moveTo(iOut[0][0], iOut[0][1]);
        for (let s = 1; s <= 7; s++) ctx.lineTo(iOut[s][0], iOut[s][1]);
        for (let s = 7; s >= 0; s--) ctx.lineTo(iIn[s][0], iIn[s][1]);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }

    const trailPositions = () => getView().bodies.map(b => ({ x: b.x, y: b.y }));
    function clearDiscontinuousTrails(before, trails = getEffects().trails) {
      getView().bodies.forEach((b, i) => {
        if (before[i] && (before[i].x - b.x) ** 2 + (before[i].y - b.y) ** 2 > 1) trails[i].length = 0;
      });
    }
    function recordTrails(trails = getEffects().trails) {
      if (isReducedMotion()) return;
      getView().bodies.forEach((b, i) => {
        if (b.vx * b.vx + b.vy * b.vy < 625) return;
        const trail = trails[i], previous = trail[trail.length - 1];
        if (!previous || (b.x - previous.x) ** 2 + (b.y - previous.y) ** 2 >= 25) {
          const duration = .24;
          const heat = b.team === -1 ? ballHeat(b) : 0;
          trail.push({ x: b.x, y: b.y, life: duration, duration, heat });
          if (trail.length > 40) trail.shift();
        }
      });
    }

    function drawStickyTether(host, ball) {
      const dx = ball.x - host.x, dy = ball.y - host.y, d = Math.hypot(dx, dy);
      if (d <= Math.abs(host.radius - ball.radius) || !d) return;
      const view = getView(), ctx = view.ctx;
      const ux = dx / d, uy = dy / d;
      const c = (host.radius - ball.radius) / d, t = Math.sqrt(Math.max(0, 1 - c * c));
      const ends = [-1, 1].map(sign => {
        const nx = ux * c - sign * uy * t, ny = uy * c + sign * ux * t;
        return { ax: host.x + nx * host.radius, ay: host.y + ny * host.radius,
          bx: ball.x + nx * ball.radius, by: ball.y + ny * ball.radius };
      });
      ctx.save();
      const pulse = isReducedMotion() ? .65 : .65 + .15 * Math.sin(getElapsed() * 14);
      ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.moveTo(ends[0].ax, ends[0].ay);
      ctx.lineTo(ends[0].bx, ends[0].by); ctx.lineTo(ends[1].bx, ends[1].by);
      ctx.lineTo(ends[1].ax, ends[1].ay); ctx.closePath();
      ctx.fillStyle = '#44dd662b'; ctx.fill();
      ctx.lineCap = 'round'; ctx.shadowColor = '#44dd66';
      ctx.shadowBlur = (isReducedMotion() || bench?.flags.noGlowBlur) ? 0 : 8 * view.canvas.width / 1000;
      for (const e of ends) {
        line(e.ax, e.ay, e.bx, e.by, '#44dd66', 3);
        line(e.ax, e.ay, e.bx, e.by, '#d9ffe3', 1);
      }
      ctx.restore();
    }

    function drawSuperAura(b, key, reach) {
      const ctx = getView().ctx;
      const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
      const level = b.superActive || b.superArm ? 2 : 1, still = isReducedMotion();
      const t = still ? 0 : clockNow() / 1000, spin = t * (.6 + level * 1.2);
      const ringR = reach + 6 + level * 2;
      ctx.save();
      const haloR = ringR + 10 + level * 4 + (still ? 0 : Math.sin(t * 3) * 2);
      ctx.globalAlpha = level === 2 ? .45 : .22;
      ctx.drawImage(superGlowSprite(key, doc), b.x - haloR, b.y - haloR, haloR * 2, haloR * 2);
      ctx.lineCap = 'round';
      if (key === 'shockwave' && b.superActive === 'shockwave' && b.shockwaveFired) {
        const ringCount = 4;
        const rate = 1.35;
        const startR = reach + 3;
        const maxR = reach + 86;
        const peakAlpha = .88;
        for (let w = 0; w < ringCount; w++) {
          const p = still ? (w + .3) / ringCount : (t * rate + w / ringCount) % 1;
          const ease = 1 - (1 - p) ** 1.65;
          const r = startR + (maxR - startR) * ease;
          const fadeIn = Math.min(1, p / .14);
          const fadeOut = (1 - p) ** 1.45;
          const alpha = peakAlpha * fadeIn * fadeOut;
          if (alpha <= .01) continue;
          const width = 4.2 * (1 - p * .62);
          ctx.globalAlpha = alpha * .42;
          circle(b.x, b.y, r, c2, width * 2.1);
          ctx.globalAlpha = alpha;
          circle(b.x, b.y, r, w % 2 === 0 ? c1 : '#ffb3c9', width);
        }
        ctx.globalAlpha = .7;
        circle(b.x, b.y, ringR, c1, 2.2);
        ctx.restore();
        return;
      }
      ctx.globalAlpha = level === 2 ? .75 : .55;
      circle(b.x, b.y, ringR, c1, level === 2 ? 2.5 : 2);
      ctx.globalAlpha = level === 2 ? 1 : .85;
      for (const [radius, dir] of level === 2 ? [[ringR, 1], [ringR + 5, -1]] : [[ringR, 1]]) {
        const sprite = conicRingSprite(key, radius, level === 2 ? 3.5 : 3, doc), size = sprite.size;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(spin * dir);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      if (level === 2 && !still) for (let k = 0; k < 2; k++) {
        const head = spin * 1.5 + k * Math.PI;
        for (let s = 4; s >= 0; s--) {
          const angle = head - s * .08;
          ctx.globalAlpha = (1 - s / 5) * .8;
          ctx.fillStyle = s ? (k ? c2 : c1) : '#ffffff';
          ctx.beginPath(); ctx.arc(b.x + Math.cos(angle) * ringR, b.y + Math.sin(angle) * ringR, 2.2 - s * .3, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }

    function drawSuperBadge(b, key) {
      const icon = superImages[b.equippedSuper?.id ?? 0];
      if (!icon?.complete || !icon.naturalWidth) return;
      const view = getView(), badgeCtx = view.badgeCtx;
      const [c1] = SUPER_AURA_THEMES[key] || ['#ff7197'];
      const size = b.superActive || b.superArm ? 24 : 20, p = badgePoint(b);
      badgeCtx.save();
      badgeCtx.translate(p.x, p.y); if (view.portrait) badgeCtx.rotate(Math.PI / 2);
      badgeCtx.beginPath(); badgeCtx.arc(0, 0, size / 2 + 2, 0, Math.PI * 2);
      badgeCtx.fillStyle = '#0b0d10d9'; badgeCtx.fill();
      badgeCtx.lineWidth = 1.5; badgeCtx.strokeStyle = c1; badgeCtx.stroke();
      badgeCtx.drawImage(icon, -size / 2, -size / 2, size, size);
      badgeCtx.restore();
    }

    function drawParticles(home, away, overlay = false) {
      if (bench?.flags.noParticles) return;
      const view = getView(), fx = getEffects();
      const c = overlay ? view.badgeCtx : view.ctx;
      c.save(); c.lineCap = 'round';
      if (overlay) {
        for (const f of fx.fireworks) {
          if ((f.delay || 0) > 0) continue;
          const cometColor = f.team === 0 ? home : away;
          c.globalAlpha = .92;
          c.drawImage(glowSprite(cometColor, doc), f.x - 18, f.y - 18, 36, 36);
          c.beginPath(); c.moveTo(f.x - (f.vx || 0) * .035, f.y - f.vy * .035); c.lineTo(f.x, f.y);
          c.strokeStyle = '#ffe9b0'; c.lineWidth = 2.8; c.stroke();
          c.fillStyle = '#ffffff'; c.beginPath(); c.arc(f.x, f.y, 2.1, 0, Math.PI * 2); c.fill();
        }
      }
      const flameDots = [];
      for (const p of fx.particles) {
        if (Boolean(p.overlay) !== overlay) continue;
        const color = p.color || (p.team === -1 ? '#ffffff' : p.team === 0 ? home : away), fade = p.life / p.duration;
        const shimmer = p.celebration && fade < .38 ? .55 + .45 * Math.sin((p.twinkle || 0) + fade * 38) : 1;
        const baseAlpha = Math.min(1, fade * 2) * (p.celebration || p.snap ? .95 : .65) * shimmer;
        c.globalAlpha = baseAlpha;
        if (p.flash) {
          const size = (p.flashSize || 170) * fade; c.globalAlpha = fade * .85;
          c.drawImage(glowSprite(color, doc), p.x - size / 2, p.y - size / 2, size, size); continue;
        }
        if (p.materialShape) {
          c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
          c.strokeStyle = c.fillStyle = color; c.lineWidth = p.snap ? 2.4 : 1;
          const size = p.size * Math.min(1, fade * 2);
          c.beginPath();
          if (p.materialShape === 'spark') {
            c.moveTo(-size, 0); c.lineTo(size, 0); c.moveTo(0, -size); c.lineTo(0, size); c.stroke();
          } else if (p.materialShape === 'streak') {
            c.moveTo(-size * 2, 0); c.lineTo(size * 2, 0); c.stroke();
          } else if (p.materialShape === 'shard') {
            c.moveTo(0, -size * 1.6); c.lineTo(size, size); c.lineTo(-size, size); c.closePath(); c.fill();
          } else if (p.materialShape === 'chip') {
            c.fillRect(-size / 2, -size / 2, size, size);
          } else {
            c.arc(0, 0, size, 0, Math.PI * 2);
            if (p.materialShape === 'bubble') c.stroke(); else c.fill();
          }
          c.restore(); continue;
        }
        if (p.flame) {
          flameDots.push({ x: p.x, y: p.y, r: p.flame * .45 * (.4 + .6 * fade), color, alpha: c.globalAlpha });
          continue;
        }
        if (p.celebration) {
          const starSize = p.size || 2;
          const halo = (34 + 18 * fade) * (starSize / 2);
          c.drawImage(glowSprite(color, doc), p.x - halo / 2, p.y - halo / 2, halo, halo);
          const tailDt = .058 * (.35 + .65 * fade);
          const tx = p.x - p.vx * tailDt, ty = p.y - p.vy * tailDt;
          c.globalAlpha = baseAlpha * .42;
          c.beginPath(); c.moveTo(tx, ty); c.lineTo(p.x, p.y); c.strokeStyle = color; c.lineWidth = starSize * 1.45; c.stroke();
          c.globalAlpha = baseAlpha;
          c.beginPath(); c.moveTo((tx + p.x) * .5, (ty + p.y) * .5); c.lineTo(p.x, p.y); c.strokeStyle = color; c.lineWidth = starSize; c.stroke();
          c.fillStyle = color; c.beginPath(); c.arc(p.x, p.y, starSize * (.65 + .35 * fade), 0, Math.PI * 2); c.fill();
          c.fillStyle = '#ffffff'; c.beginPath(); c.arc(p.x, p.y, Math.max(.75, starSize * .48 * fade), 0, Math.PI * 2); c.fill();
          continue;
        }
        const px = p.px === p.x && p.py === p.y ? p.x - 0.01 : p.px;
        c.beginPath(); c.moveTo(px, p.py); c.lineTo(p.x, p.y); c.strokeStyle = color; c.lineWidth = p.snap ? 2.6 : 1.3; c.stroke();
        c.fillStyle = color; c.beginPath(); c.arc(p.x, p.y, p.snap ? 1.9 : .9, 0, Math.PI * 2); c.fill();
      }
      if (flameDots.length) {
        c.save(); c.globalCompositeOperation = 'lighter';
        for (const f of flameDots) {
          c.globalAlpha = f.alpha; c.fillStyle = f.color;
          c.beginPath(); c.arc(f.x, f.y, f.r, 0, Math.PI * 2); c.fill();
        }
        c.restore();
      }
      c.restore();
    }

    function drawImpulse(body, plan, color) {
      if (!plan) return;
      const arrow = impulseGeometry(P, body, plan);
      if (!arrow.visible) return;
      const ctx = getView().ctx;
      const startX = body.x + Math.cos(plan.angle) * arrow.ringR;
      const startY = body.y + Math.sin(plan.angle) * arrow.ringR;
      const endX = arrow.x, endY = arrow.y;

      ctx.save();
      if (plan.guard) ctx.globalAlpha = .25;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();

      const tipAngle = plan.angle;
      for (const offset of [-0.55, 0.55]) {
        line(endX, endY, endX - Math.cos(tipAngle + offset) * 14, endY - Math.sin(tipAngle + offset) * 14, color, 4);
      }
      ctx.restore();
    }

    function drawGuides(home, away, text, guide) {
      const view = getView(), ctx = view.ctx, badgeCtx = view.badgeCtx;
      if (guideShown('trails', guide)) {
        ctx.save(); ctx.lineCap = ctx.lineJoin = 'round';
        guide.paths.forEach((path, i) => {
          const color = i < 3 ? home : i < 6 ? away : text;
          ctx.globalAlpha = .6; ctx.lineWidth = i < 6 ? 3 : 2; ctx.strokeStyle = color;
          ctx.beginPath(); ctx.moveTo(path[0], path[1]);
          for (let k = 2; k < path.length; k += 2) ctx.lineTo(path[k], path[k + 1]);
          ctx.stroke();
          ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(path[0], path[1], i < 6 ? 4 : 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        });
        ctx.restore();
      }
      if (guideShown('moves', guide)) {
        guide.start.slice(0, 6).forEach((b, i) => {
          const plan = guide.moves[i], color = i < 3 ? home : away;
          ctx.save(); ctx.globalAlpha = .7; ctx.setLineDash([4, 6]); circle(b.x, b.y, b.radius, color, 2); ctx.restore();
          drawImpulse(b, plan, color);
          if (plan.guard && !b.stunned) {
            badgeCtx.save(); badgeCtx.translate(b.x + b.radius * .65, b.y + b.radius * .65); if (view.portrait) badgeCtx.rotate(Math.PI / 2);
            const guideIron = Boolean(b.ironGuard);
            badgeCtx.globalAlpha = .85; badgeCtx.scale(1.1, 1.1); badgeCtx.translate(-12, -12);
            badgeCtx.fillStyle = guideIron ? '#c3ccd6' : '#4798ff'; badgeCtx.fill(GUARD_SHIELD);
            if (guideIron) {
              badgeCtx.strokeStyle = '#6b7785';
              badgeCtx.lineWidth = 1.5;
              badgeCtx.stroke(GUARD_SHIELD);
            }
            badgeCtx.restore();
          }
          if ((plan.superArm || b.superArm) && b.equippedSuper && b.meter >= 100 && !b.stunned) drawSuperBadge({ ...b, superArm: true }, b.equippedSuper.key);
        });
      }
    }

    function handleCollision(contact) {
      const { a, b, speed = 0, impulse = 0, plow = false, iron = false, snapped = false, spinStruck = false, tangentImpulse = 0, passerSlot = -1 } = contact;
      if (iron) {
        if (a?.guarding) a.ironGuard = true;
        if (b?.guarding) b.ironGuard = true;
      }
      const isBall = a.team === -1 || b.team === -1;
      const isSnap = isBall && Boolean(snapped);
      const isSpinStrike = isBall && Boolean(spinStruck);
      const isHipClip = !isBall && a.team !== b.team && tangentImpulse >= 55 && tangentImpulse >= speed * 0.22;
      const isCheck = !isBall && a.team !== b.team && !isHipClip && speed >= 65;
      const spinBoost = !isBall && a.team !== b.team ? (tangentImpulse || 0) * 0.45 : 0;
      const effSpeed = Math.max(speed, spinBoost);
      if (effSpeed < 15 && !isSnap && !isSpinStrike) return;
      const fx = getEffects();
      const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const x = a.x + (b.x - a.x) * a.radius / distance, y = a.y + (b.y - a.y) * a.radius / distance;
      const normalAngle = Math.atan2(b.y - a.y, b.x - a.x);
      const tangent = normalAngle + Math.PI / 2;
      const sparkStrength = Math.min(1.35, effSpeed / 600);
      burst(x, y, a.team, sparkStrength, false, tangent);
      if (a.team !== b.team) burst(x, y, b.team, sparkStrength, false, tangent);
      if (isHipClip && !isReducedMotion()) {
        const hipStrength = Math.min(1, Math.max(0.12, (Math.max(tangentImpulse, effSpeed * 0.42) - 50) / 195));
        const dur = 0.14 + 0.10 * hipStrength;
        if (fx.shockwaves.length < 30) {
          fx.shockwaves.push({
            x, y,
            currentRadius: 10 + 2 * hipStrength,
            maxRadius: 12 + 42 * (0.35 + 0.65 * hipStrength),
            team: a.team, teamB: b.team, tangent, hipClip: true,
            strength: hipStrength,
            life: dur, duration: dur,
            width: 2.2 + 3.3 * hipStrength,
            overlay: true
          });
        }
        if (fx.particles.length < 400) {
          const flashLife = 0.10 + 0.06 * hipStrength;
          fx.particles.push({
            x, y, px: x, py: y, vx: 0, vy: 0, team: -1, color: '#ffffff',
            life: flashLife, duration: flashLife,
            flash: true, flashSize: Math.round(32 + 56 * hipStrength), overlay: true
          });
        }
        const streakCount = Math.round(3 + 11 * hipStrength);
        for (let k = 0; k < streakCount && fx.particles.length < 400; k++) {
          const dir = k % 2 === 0 ? tangent : tangent + Math.PI;
          const ang = dir + (Math.random() - 0.5) * 0.38;
          const spd = 115 + 75 * hipStrength + Math.random() * (90 + 140 * hipStrength);
          const life = 0.13 + 0.05 * hipStrength + Math.random() * (0.07 + 0.05 * hipStrength);
          const sx = x + Math.cos(ang) * 6, sy = y + Math.sin(ang) * 6;
          fx.particles.push({
            x: sx, y: sy, px: sx - Math.cos(ang) * 7, py: sy - Math.sin(ang) * 7,
            vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
            team: k % 2 === 0 ? a.team : b.team,
            color: k % 5 === 0 ? '#ffffff' : null,
            life, duration: life,
            materialShape: 'streak', size: 1.8 + 1.2 * hipStrength + Math.random() * 1.8 * hipStrength, angle: ang, snap: true, overlay: true
          });
        }
      } else if (isCheck && !isReducedMotion()) {
        const checkStrength = Math.min(1, Math.max(0.12, (speed - 65) / 455));
        const dur = 0.14 + 0.10 * checkStrength;
        if (fx.shockwaves.length < 30) {
          fx.shockwaves.push({
            x, y,
            currentRadius: 9 + 3 * checkStrength,
            maxRadius: 11 + 41 * (0.35 + 0.65 * checkStrength),
            team: a.team, teamB: b.team, normalAngle, check: true,
            strength: checkStrength,
            life: dur, duration: dur,
            width: 2.2 + 3.6 * checkStrength,
            overlay: true
          });
        }
        if (fx.particles.length < 400) {
          const flashLife = 0.09 + 0.07 * checkStrength;
          fx.particles.push({
            x, y, px: x, py: y, vx: 0, vy: 0, team: -1, color: '#ffffff',
            life: flashLife, duration: flashLife,
            flash: true, flashSize: Math.round(28 + 60 * checkStrength), overlay: true
          });
        }
        const streakCount = Math.round(2 + 12 * checkStrength);
        for (let k = 0; k < streakCount && fx.particles.length < 400; k++) {
          const baseDir = k % 2 === 0 ? tangent : tangent + Math.PI;
          const ang = baseDir + (Math.random() - 0.5) * 0.65;
          const spd = 105 + 80 * checkStrength + Math.random() * (85 + 145 * checkStrength);
          const life = 0.12 + 0.06 * checkStrength + Math.random() * (0.06 + 0.06 * checkStrength);
          const sx = x + Math.cos(ang) * 5, sy = y + Math.sin(ang) * 5;
          fx.particles.push({
            x: sx, y: sy, px: sx - Math.cos(ang) * 6, py: sy - Math.sin(ang) * 6,
            vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
            team: k % 2 === 0 ? a.team : b.team,
            color: k % 5 === 0 ? '#ffffff' : null,
            life, duration: life,
            materialShape: 'streak', size: 1.7 + 1.3 * checkStrength + Math.random() * 1.7 * checkStrength, angle: ang, snap: true, overlay: true
          });
        }
      }
      if (isSnap && !isReducedMotion()) {
        const ball = a.team === -1 ? a : b;
        const snapper = a.team === -1 ? b : a;
        const snapTeam = snapper?.team >= 0 ? snapper.team : 0;
        const heading = Math.atan2(ball.vy || 0, ball.vx || 0);
        // Twin crisp team-colored redirect rings starting outside the ball silhouette so they are immediately visible
        if (fx.shockwaves.length < 30) {
          fx.shockwaves.push({ x: ball.x, y: ball.y, currentRadius: 19, maxRadius: 66, team: snapTeam, color: null, life: .28, duration: .28, overlay: true });
          fx.shockwaves.push({ x: x, y: y, currentRadius: 12, maxRadius: 46, team: snapTeam, color: null, life: .22, duration: .22, overlay: true });
        }
        if (fx.particles.length < 400) {
          fx.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, team: snapTeam, color: null, life: .22, duration: .22, flash: true, flashSize: 135, overlay: true });
        }
        for (let k = 0; k < 22 && fx.particles.length < 400; k++) {
          const isWing = k >= 12;
          const ang = isWing
            ? heading + (k % 2 ? 1 : -1) * (0.65 + Math.random() * 0.48)
            : heading + (Math.random() - .5) * .48;
          const spd = isWing ? 210 + Math.random() * 200 : 260 + Math.random() * 310;
          const life = .24 + Math.random() * .14;
          const spawnR = ball.radius * 0.65;
          const sx = ball.x + Math.cos(ang) * spawnR, sy = ball.y + Math.sin(ang) * spawnR;
          const p = { x: sx, y: sy, px: sx - Math.cos(ang) * 8, py: sy - Math.sin(ang) * 8,
            vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
            team: snapTeam, color: null, life, duration: life, snap: true, overlay: true };
          if (k < 6) {
            p.materialShape = 'streak';
            p.size = 3.2 + Math.random() * 1.6;
            p.angle = ang;
          }
          fx.particles.push(p);
        }
      }
      if (isSpinStrike && !isReducedMotion()) {
        const ball = a.team === -1 ? a : b;
        const striker = a.team === -1 ? b : a;
        const strikeTeam = striker?.team >= 0 ? striker.team : 0;
        const heading = Math.atan2(ball.vy || 0, ball.vx || 0);
        const spinVal = ball.omega || -(striker?.omega || 0) || 14;
        const spinDir = Math.sign(spinVal) || 1;
        const spinPower = Math.min(1, Math.max(0.35, Math.abs(spinVal) / 20));
        if (fx.shockwaves.length < 30) {
          fx.shockwaves.push({
            x: ball.x, y: ball.y,
            currentRadius: 18, maxRadius: 68 + 10 * spinPower,
            team: strikeTeam, color: null,
            spinStrike: true, spinDir, startAngle: heading, blades: 3,
            width: 3.6 + 1.4 * spinPower,
            life: 0.30, duration: 0.30, overlay: true
          });
          fx.shockwaves.push({
            x, y,
            currentRadius: 11, maxRadius: 46 + 8 * spinPower,
            team: strikeTeam, color: null,
            spinStrike: true, spinDir, startAngle: heading + spinDir * 0.55, blades: 2,
            width: 2.8 + 1.0 * spinPower,
            life: 0.23, duration: 0.23, overlay: true
          });
        }
        if (fx.particles.length < 400) {
          fx.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, team: strikeTeam, color: null, life: 0.22, duration: 0.22, flash: true, flashSize: 128, overlay: true });
          fx.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, team: -1, color: '#ffffff', life: 0.12, duration: 0.12, flash: true, flashSize: 64, overlay: true });
        }
        for (let k = 0; k < 20 && fx.particles.length < 400; k++) {
          const isSwirlWing = k < 12;
          const radialAng = isSwirlWing
            ? heading + (k / 12) * Math.PI * 2
            : heading + (Math.random() - 0.5) * 0.52;
          const moveAng = isSwirlWing
            ? radialAng + spinDir * (1.05 + (Math.random() - 0.5) * 0.25)
            : radialAng + spinDir * 0.22;
          const spd = isSwirlWing ? 185 + Math.random() * 210 : 250 + Math.random() * 290;
          const life = 0.20 + Math.random() * 0.14;
          const spawnR = ball.radius * (isSwirlWing ? 0.85 : 0.65);
          const sx = ball.x + Math.cos(radialAng) * spawnR;
          const sy = ball.y + Math.sin(radialAng) * spawnR;
          const p = {
            x: sx, y: sy,
            px: sx - Math.cos(moveAng) * 8, py: sy - Math.sin(moveAng) * 8,
            vx: Math.cos(moveAng) * spd, vy: Math.sin(moveAng) * spd,
            team: strikeTeam,
            color: k % 4 === 0 ? '#ffffff' : null,
            life, duration: life, snap: true, overlay: true
          };
          if (k < 8) {
            p.materialShape = 'streak';
            p.size = 2.8 + Math.random() * 1.8;
            p.angle = moveAng;
          }
          fx.particles.push(p);
        }
      }
      if (plow) flames(x, y, 40, (b.vx || a.vx) * 0.1, (b.vy || a.vy) * 0.1, 15);
      const now = clockNow();
      if (!plow && speed >= 15) contactMeter?.(a, b, speed, passerSlot);
      if (isBall) {
        const ball = a.team === -1 ? a : b;
        const player = a.team !== -1 ? a : b;
        const norm = Math.min(1.0, Math.max(0.0, (speed - 25) / 550));
        const volume = Math.min(1.0, 0.15 + 0.85 * (norm ** 0.8));
        if (isSpinStrike && gameAudio()?.playSpinStrike) {
          const sMap = (fx.spinStrikeTimes ||= new WeakMap());
          if (now - (sMap.get(ball) ?? -Infinity) > 50) {
            sMap.set(ball, now);
            gameAudio().playSpinStrike({ volume: Math.min(1.0, 0.45 + 0.55 * (norm ** 0.8)), spin: ball.omega || player.omega || 14, x, y });
          }
        }
        const isFlamingCollision = (plow || P.ballOnFire?.(ball)) && (now - (fx.lastCannonImpact ?? -Infinity) > 20);
        if (isFlamingCollision) {
          fx.ballFlare = Math.max(fx.ballFlare || 0, 0.85);
          const nx = (ball.x - player.x) / distance, ny = (ball.y - player.y) / distance;
          const ubuIndex = player.playerIndex ?? (getView().bodies?.indexOf(player) ?? -1);
          fx.fireWarp = { x, y, nx, ny, ubuIndex, life: 0.28, duration: 0.28 };
          if (!isReducedMotion() && fx.particles.length < 400) {
            fx.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, team: -1, color: '#ff7a1a', life: 0.20, duration: 0.20, flash: true, flashSize: 125, overlay: true });
            fx.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, team: -1, color: '#fff3b0', life: 0.12, duration: 0.12, flash: true, flashSize: 66, overlay: true });
          }
        }
        const fireHit = !iron && isFlamingCollision;
        if (fireHit && gameAudio()?.playFireImpact && (now - (fx.lastFireHitSound ?? -Infinity) > 55)) {
          fx.lastFireHitSound = now;
          gameAudio().playFireImpact({ volume: Math.min(1.0, 0.42 + 0.58 * (norm ** 0.8)), x, y });
        }
        if (isSnap || isSpinStrike || !player._lastHitSound || (now - player._lastHitSound) > 55) {
          player._lastHitSound = now;
          if (player.voice && gameAudio()) {
            gameAudio().playCollision(player.voice, { volume, x, y });
          }
          if (gameAudio()) {
            gameAudio().playBallHit({ volume: isSnap ? Math.min(1.0, volume * 1.15) : volume, snap: isSnap, x, y });
          }
        }
      } else if (a.team !== -1 && b.team !== -1) {
        const norm = Math.min(1.0, Math.max(0.0, (effSpeed - 40) / 600));
        const volume = Math.min(1.0, 0.12 + 0.75 * (norm ** 0.8));
        if (isHipClip && gameAudio()?.playSpinStrike && (now - (fx.lastHipClipSound ?? -Infinity) > 65)) {
          fx.lastHipClipSound = now;
          gameAudio().playSpinStrike({
            volume: Math.min(0.95, 0.38 + 0.55 * (norm ** 0.8)),
            spin: Math.max(Math.abs(a.omega || 0), Math.abs(b.omega || 0), 12),
            crack: false,
            x, y
          });
        }
        const primary = (Math.hypot(a.vx, a.vy) * a.mass >= Math.hypot(b.vx, b.vy) * b.mass) ? a : b;
        if (primary.voice && gameAudio()) {
          if (!primary._lastHitSound || (now - primary._lastHitSound) > 65) {
            primary._lastHitSound = now;
            gameAudio().playCollision(primary.voice, { volume, x, y });
          }
        }
      }
    }

    function handleWall(body, velocity, wallType, nx, ny, rimmed = false) {
      if (velocity < 20 && !rimmed) return;
      const fx = getEffects(), view = getView();
      addWallEffect(body, velocity, wallType, nx, ny);
      const cx = body.x + nx * body.radius, cy = body.y + ny * body.radius;
      const tangent = Math.atan2(ny, nx) + Math.PI / 2;
      const now = clockNow();
      if (rimmed) {
        const speed = Math.hypot(body.vx || 0, body.vy || 0);
        const speedNorm = Math.min(1, Math.max(0, (speed - 60) / 480));
        if (!isReducedMotion()) {
          const idx = view.bodies?.indexOf(body) ?? -1;
          if (idx >= 0 && idx < 6) {
            const s = fx.skidState[idx] ||= { time: 0 };
            Object.assign(s, { time: Math.max(s.time || 0, .25), strength: Math.max(s.time > 0 ? s.strength : 0, .62 + .35 * speedNorm) });
          }
          const moveAng = Math.atan2(body.vy || 0, body.vx || 0);
          const sprayBase = moveAng + Math.PI;
          const inwardAngle = Math.atan2(-ny, -nx);
          const count = 7 + Math.round(6 * speedNorm);
          const sparkColors = ['#fff1c1', '#fff3b0', '#ffc43d', '#ffb347', '#ff7a1a'];
          for (let k = 0; k < count && fx.particles.length < 450; k++) {
            const frac = k / Math.max(1, count - 1);
            const ang = sprayBase * (1 - frac * 0.42) + inwardAngle * (frac * 0.42) + (Math.random() - .5) * .38;
            const spd = (65 + Math.random() * 125) * (0.7 + 0.55 * speedNorm);
            const life = .14 + Math.random() * .15;
            const p = {
              x: cx, y: cy, px: cx, py: cy,
              vx: Math.cos(ang) * spd - nx * (18 + 20 * frac),
              vy: Math.sin(ang) * spd - ny * (18 + 20 * frac),
              team: -1,
              color: sparkColors[k % sparkColors.length],
              life, duration: life,
              snap: true,
              overlay: true
            };
            if (k % 2 === 0) {
              p.materialShape = 'streak';
              p.angle = ang;
              p.size = 2.4 + Math.random() * 1.8;
            }
            fx.particles.push(p);
          }
        }
        const map = (fx.carveTimes ||= new WeakMap());
        if (now - (map.get(body) ?? -Infinity) >= 180) {
          map.set(body, now);
          gameAudio()?.playCarve?.({ volume: Math.min(0.58, 0.16 + 0.38 * Math.min(1, speed / 550)), speed, rimmed: true, x: cx, y: cy });
        }
        return;
      }
      if (body._lastWallSound && (now - body._lastWallSound) < 60) return;
      body._lastWallSound = now;
      burst(cx, cy, body.team, Math.min(1, velocity / 500), false, tangent);
      if (wallType === 'post' && body.team === -1 && velocity >= 240 && !isReducedMotion()) {
        const reflectAng = Math.atan2(-ny, -nx);
        for (let k = 0; k < 12 && fx.particles.length < 450; k++) {
          const ang = (k < 8 ? tangent + (k % 2 ? Math.PI : 0) : reflectAng) + (Math.random() - .5) * .42;
          const spd = 85 + Math.random() * 165, life = .16 + Math.random() * .15;
          const p = { x: cx, y: cy, px: cx, py: cy,
            vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
            team: -1, color: k % 3 === 0 ? '#ffae33' : k % 2 ? '#ffd76b' : '#ffffff', life, duration: life };
          if (k % 2 === 0) {
            p.materialShape = 'streak';
            p.angle = ang;
            p.size = 3.6 + Math.random() * 2.4;
            p.snap = true;
          }
          fx.particles.push(p);
        }
      }
      const norm = Math.min(1.0, Math.max(0.0, (velocity - 20) / 480));
      const volume = Math.min(1.0, 0.15 + 0.85 * (norm ** 0.8));
      if (body.team === -1 && P.ballOnFire?.(body) && velocity >= 60) {
        fx.ballFlare = Math.max(fx.ballFlare || 0, 0.85);
        fx.fireWarp = { x: cx, y: cy, nx, ny, life: 0.28, duration: 0.28 };
        if (!isReducedMotion() && fx.particles.length < 450) {
          fx.particles.push({ x: cx, y: cy, px: cx, py: cy, vx: 0, vy: 0, team: -1, color: '#ff7a1a', life: 0.18, duration: 0.18, flash: true, flashSize: 115, overlay: true });
          fx.particles.push({ x: cx, y: cy, px: cx, py: cy, vx: 0, vy: 0, team: -1, color: '#fff3b0', life: 0.11, duration: 0.11, flash: true, flashSize: 60, overlay: true });
          for (let k = 0; k < 10 && fx.particles.length < 450; k++) {
            const side = k % 2 ? 1 : -1;
            const ang = tangent + (side < 0 ? Math.PI : 0) + (Math.random() - 0.5) * 0.28;
            const spd = 110 + Math.random() * 170, life = 0.18 + Math.random() * 0.14;
            fx.particles.push({
              x: cx, y: cy, px: cx, py: cy,
              vx: Math.cos(ang) * spd - nx * 24, vy: Math.sin(ang) * spd - ny * 24,
              team: -1,
              color: k % 3 === 0 ? '#fff3b0' : k % 2 === 0 ? '#ff9f1c' : '#ff5400',
              life, duration: life,
              materialShape: 'streak', angle: ang, size: 3.8 + Math.random() * 2.6, snap: true, overlay: true
            });
          }
          for (let k = 0; k < 7 && fx.particles.length < 450; k++) {
            const ang = Math.atan2(-ny, -nx) + (Math.random() - 0.5) * 1.5;
            const spd = 25 + Math.random() * 65, life = 0.28 + Math.random() * 0.18;
            fx.particles.push({
              x: cx, y: cy, px: cx, py: cy,
              vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              team: -1,
              color: k % 2 === 0 ? '#1f130b' : '#000000',
              life, duration: life
            });
          }
        }
      }
      const audio = gameAudio();
      if (!audio) return;
      if (body.team === -1 && P.ballOnFire?.(body) && velocity >= 90 && (now - (fx.lastFireHitSound ?? -Infinity) > 55)) {
        fx.lastFireHitSound = now;
        audio.playFireImpact?.({ volume: Math.min(0.9, 0.32 + 0.55 * (norm ** 0.85)), x: cx, y: cy });
      }
      if (wallType === 'post') {
        audio.playGoalHit('post', { volume: Math.min(1.0, volume * 1.1), spin: Math.abs(body.omega || 0), speed: velocity, x: cx, y: cy });
      } else if (wallType === 'net') {
        audio.playGoalHit('net', { volume, x: cx, y: cy });
      } else {
        audio.playWallHit({ volume: Math.min(0.85, 0.1 + 0.68 * (norm ** 1.05)), speed: velocity, x: cx, y: cy });
      }
    }

    function handleSuper(key, stage, body, target = null) {
      const fx = getEffects(), view = getView();
      if (key === 'cannonball' && stage === 'impact') fx.lastCannonImpact = clockNow();
      if (key === 'stalwart' && stage === 'impact') {
        const now = clockNow();
        if (now - (fx.superImpactTimes.get(body) ?? -Infinity) < 100) return;
        fx.superImpactTimes.set(body, now);
      }
      if (stage === 'impact' && target && !isReducedMotion()) {
        const dx = target.x - body.x, dy = target.y - body.y;
        const distance = Math.hypot(dx, dy) || 1;
        const nx = dx / distance, ny = dy / distance;
        const reach = target.team === -1 ? Math.max(body.radius, body.reach || body.radius, 18) : body.radius;
        const x = body.x + nx * reach, y = body.y + ny * reach;
        const tangent = Math.atan2(dy, dx) + Math.PI / 2;
        if (key === 'knockout') {
          burst(x, y, target.team, 3, false, tangent, '#ee2b47');
          const attackerIdx = body.playerIndex ?? (view.bodies?.indexOf(body) ?? -1);
          const targetIdx = target.playerIndex ?? (view.bodies?.indexOf(target) ?? -1);
          fx.koWarp = { attackerIdx, targetIdx, nx, ny, life: 0.26, duration: 0.26 };
          const normalAngle = Math.atan2(dy, dx);
          if (fx.shockwaves.length < 40) {
            fx.shockwaves.push({
              x, y, currentRadius: 12, maxRadius: 78,
              team: body.team, color: '#ee2b47',
              life: 0.30, duration: 0.30,
              koCone: true, normalAngle, width: 6.5, overlay: true
            });
            fx.shockwaves.push({
              x, y, currentRadius: 8, maxRadius: 56,
              team: body.team, color: '#ff7197',
              life: 0.22, duration: 0.22,
              koCone: true, normalAngle, width: 4.2, overlay: true
            });
          }
          if (fx.particles.length < 450) {
            fx.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, team: -1, color: '#ee2b47', life: 0.18, duration: 0.18, flash: true, flashSize: 110, overlay: true });
            for (let k = 0; k < 14 && fx.particles.length < 450; k++) {
              const ang = normalAngle + (Math.random() - 0.5) * 1.05;
              const spd = 180 + Math.random() * 240, life = 0.16 + Math.random() * 0.14;
              fx.particles.push({
                x: target.x, y: target.y, px: target.x, py: target.y,
                vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
                team: body.team,
                color: k % 3 === 0 ? '#ffffff' : k % 2 === 0 ? '#ee2b47' : '#ff7197',
                life, duration: life,
                materialShape: 'streak', angle: ang, size: 4.5 + Math.random() * 3.0, snap: true, overlay: true
              });
            }
          }
        } else if (key === 'cannonball' || key === 'stalwart') {
          const color = key === 'cannonball' ? '#ff634d' : '#ffd166';
          if (key === 'cannonball') fx.ballFlare = 1;
          burst(x, y, body.team, 3.5, false, tangent, color);
          if (fx.shockwaves.length < 32) fx.shockwaves.push({ x, y, currentRadius: 4,
            maxRadius: key === 'cannonball' ? 48 : 36, team: body.team, color, life: .24, duration: .24 });
        }
      }
      const closeness = (key === 'magnet' && stage === 'pull' && body && target)
        ? Math.max(0, Math.min(1, 1 - Math.hypot(target.x - body.x, target.y - body.y) / 190))
        : 0.5;
      gameAudio()?.playSuper?.(key, stage, { x: body?.x, y: body?.y, closeness });
    }

    function handleShockwave(source, radius, type = null) {
      const fx = getEffects();
      if (type === 'iron') {
        burst(source.x, source.y, source.team, 0.7, false, 0, '#ffffff');
        burst(source.x, source.y, source.team, 0.7, false, 0, '#d2f2ff');
        fx.shockwaves.push({ x: source.x, y: source.y, currentRadius: 8, maxRadius: radius, team: source.team, color: '#e3faff', life: 0.25, duration: 0.25 });
        return;
      }
      if (!isReducedMotion()) {
        fx.shake = Math.max(fx.shake || 0, 0.85);
        if (fx.particles.length < 850) {
          fx.particles.push({ x: source.x, y: source.y, px: source.x, py: source.y, vx: 0, vy: 0, team: source.team, color: '#ff7197', life: 0.28, duration: 0.28, flash: true, flashSize: radius * 1.45, overlay: true });
          fx.particles.push({ x: source.x, y: source.y, px: source.x, py: source.y, vx: 0, vy: 0, team: -1, color: '#ffffff', life: 0.14, duration: 0.14, flash: true, flashSize: radius * 0.8, overlay: true });
        }
        for (let k = 0; k < 26 && fx.particles.length < 850; k++) {
          const angle = (k / 26) * Math.PI * 2 + (Math.random() - 0.5) * 0.14;
          const speed = 260 + Math.random() * 240, life = 0.22 + Math.random() * 0.14;
          const r0 = (source.radius || 25) * 0.7;
          const sx = source.x + Math.cos(angle) * r0, sy = source.y + Math.sin(angle) * r0;
          fx.particles.push({
            x: sx, y: sy, px: sx, py: sy,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            team: source.team,
            color: k % 3 === 0 ? '#ffffff' : k % 2 === 0 ? '#ff7197' : '#9d467a',
            life, duration: life,
            materialShape: 'streak', angle, size: 5.5 + Math.random() * 3.5, snap: true, overlay: true
          });
        }
      }
      burst(source.x, source.y, source.team, 3.2, false, 0, '#ff7197');
      burst(source.x, source.y, source.team, 2.4, false, 0, '#ffffff');
      burst(source.x, source.y, source.team, 2.0, false, 0, '#9d467a');
      fx.shockwaves.push({ x: source.x, y: source.y, currentRadius: 14, maxRadius: radius * 1.08, team: source.team, color: '#ff7197', life: 0.45, duration: 0.45, dramatic: true, width: 12, band: true });
      fx.shockwaves.push({ x: source.x, y: source.y, currentRadius: 10, maxRadius: radius * 0.94, team: source.team, color: '#ffc2d6', life: 0.36, duration: 0.36, dramatic: true, width: 7.5 });
      fx.shockwaves.push({ x: source.x, y: source.y, currentRadius: 6, maxRadius: radius * 0.80, team: source.team, color: '#9d467a', life: 0.50, duration: 0.50, dramatic: true, width: 5.5 });
      if (gameAudio()) {
        gameAudio().playSuper?.('shockwave', 'impact', { volume: 0.85, x: source?.x, y: source?.y });
      }
    }

    function impact(ms, shakeLevel = (ububallMatch.SCREEN_SHAKE?.default ?? 1)) {
      const until = clockNow() + ms, playbackFx = getActivePlayback()?.fx;
      if (playbackFx) playbackFx.hitStopUntil = until;
      else setHitStopUntil?.(until);
      if (!isReducedMotion()) getEffects().shake = shakeLevel;
    }

    function drawScene() {
      const view = getView(), fx = getEffects(), phase = getPhase();
      const playback = getActivePlayback() || getTheater();
      const fieldPlans = playback?.plans ?? getPlans();
      const sizes = getRenderSize ? getRenderSize() : {};
      const renderWidth = sizes.renderWidth || view.canvas.clientWidth || 1000;
      const renderHeight = sizes.renderHeight || view.canvas.clientHeight || 600;
      const isCollectionPortrait = !view.field && Boolean(view.collectionPortrait);
      const nativeDpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
      const dprCap = bench?.flags.dprCap || 0;
      const effDprCap = isCollectionPortrait ? (dprCap ? Math.min(dprCap, 1.5) : 1.5) : dprCap;
      const dpr = effDprCap ? Math.min(nativeDpr, effDprCap) : nativeDpr;
      const rawW = effDprCap ? Math.round(renderWidth * dpr) : (sizes.deviceWidth || Math.round(renderWidth * dpr));
      const rawH = effDprCap ? Math.round(renderHeight * dpr) : (sizes.deviceHeight || Math.round(renderHeight * dpr));
      const maxDim = isCollectionPortrait ? 1920 : 2560;
      const cap = Math.min(1, maxDim / Math.max(1, rawW, rawH));
      const width = view.field?.width ?? Math.max(1, Math.round(rawW * cap));
      const height = view.field?.height ?? Math.max(1, Math.round(rawH * cap));
      if (view.canvas.width !== width || view.canvas.height !== height) { view.canvas.width = width; view.canvas.height = height; }
      if (!isCollectionPortrait && (view.badgeCanvas.width !== width || view.badgeCanvas.height !== height)) {
        view.badgeCanvas.width = width; view.badgeCanvas.height = height;
      }
      const colors = getThemeColors();
      const { text, home, away, background } = colors;
      if (isCollectionPortrait) {
        const { length = 1000, viewTop = 0, viewSpan = 1000 } = view.collectionPortrait;
        const safeSpan = Math.max(1, viewSpan);
        view.ctx.setTransform(width / 600, 0, 0, height / safeSpan, 0, -viewTop * (height / safeSpan));
        view.ctx.clearRect(0, viewTop - 8, 600, safeSpan + 16);
        const roundedLen = Math.max(1000, Math.round(length));
        const cacheH = Math.max(1, Math.round(roundedLen * (width / 600)));
        const logoReady = Boolean(rinkLogo?.complete && rinkLogo.naturalWidth);
        const cacheKey = `${width}x${cacheH}|${roundedLen}|${colors.surface}|${colors.border}|${background}|${home}|${away}|${logoReady ? 1 : 0}`;
        const lenSettled = Math.abs(length - roundedLen) < 0.05 && fx.portraitRinkPrevKey === cacheKey;
        fx.portraitRinkPrevKey = cacheKey;
        let usedPortraitCache = false;
        if (doc?.createElement && typeof view.ctx.drawImage === 'function' && cacheH <= 8192 && (fx.portraitRinkCache?.key === cacheKey || lenSettled)) {
          if (fx.portraitRinkCache?.key !== cacheKey) {
            const layer = fx.portraitRinkCache?.layer || doc.createElement('canvas');
            const lctx = layer?.getContext?.('2d');
            if (lctx && typeof lctx.save === 'function') {
              if (layer.width !== width || layer.height !== cacheH) { layer.width = width; layer.height = cacheH; }
              lctx.setTransform(width / 600, 0, 0, cacheH / roundedLen, 0, 0);
              lctx.clearRect(0, 0, 600, roundedLen);
              drawPortraitRinkSurface(lctx, P, ububallMatch, colors, rinkLogo, roundedLen, 0, roundedLen);
              fx.portraitRinkCache = { key: cacheKey, layer, width, height: cacheH, length: roundedLen, builds: (fx.portraitRinkCache?.builds || 0) + 1 };
            }
          }
          const pc = fx.portraitRinkCache;
          if (pc?.key === cacheKey) {
            const v0 = Math.max(0, Math.min(pc.length, viewTop));
            const v1 = Math.max(v0, Math.min(pc.length, viewTop + safeSpan));
            if (v1 > v0) {
              const sy = v0 * (pc.height / pc.length);
              const sh = (v1 - v0) * (pc.height / pc.length);
              view.ctx.drawImage(pc.layer, 0, sy, pc.width, sh, 0, v0, 600, v1 - v0);
            }
            pc.hits = (pc.hits || 0) + 1;
            usedPortraitCache = true;
          }
        }
        if (!usedPortraitCache) {
          drawPortraitRinkSurface(view.ctx, P, ububallMatch, colors, rinkLogo, length, viewTop, safeSpan);
        }
        if (!view.castHidden) {
          const skaters = getSkaters();
          view.bodies.slice(0, 6).forEach((b, i) => {
            const px = b.y, py = 1000 - b.x;
            const reachR = Math.max(b.radius, b.reach || b.radius, 18);
            if (!b.carded) {
              view.ctx.beginPath();
              view.ctx.arc(px, py, reachR + 2, 0, Math.PI * 2);
              view.ctx.strokeStyle = i < 3 ? home : away;
              view.ctx.lineWidth = 4;
              view.ctx.stroke();
            }
            if (!skaters[i]) return;
            const style = skaters[i].style;
            const wPct = (b.radius / 3) + '%';
            const rot = b.rotation - Math.PI / 2;
            const opacity = b.carded ? '0.3' : '1';
            const transform = `translate(${px / 600 * renderWidth}px, ${(py - viewTop) / safeSpan * renderHeight}px) translate(-50%, -50%) rotate(${rot}rad)`;
            let prev = skaterStyleCache.get(skaters[i]);
            if (!prev) { prev = {}; skaterStyleCache.set(skaters[i], prev); }
            if (prev.width !== wPct) { prev.width = wPct; style.width = wPct; }
            if (prev.opacity !== opacity) { prev.opacity = opacity; style.opacity = opacity; }
            if (prev.filter !== '') { prev.filter = ''; style.filter = ''; }
            if (prev.transform !== transform) { prev.transform = transform; style.transform = transform; }
          });
          const ball = view.bodies[6];
          if (ball) {
            const bx = ball.y, by = 1000 - ball.x;
            view.ctx.beginPath(); view.ctx.arc(bx, by, ball.radius, 0, Math.PI * 2); view.ctx.fillStyle = background; view.ctx.fill();
            view.ctx.beginPath(); view.ctx.arc(bx, by, ball.radius, 0, Math.PI * 2); view.ctx.strokeStyle = text; view.ctx.lineWidth = 2; view.ctx.stroke();
            const size = ball.radius * 1.7;
            view.ctx.save(); view.ctx.translate(bx, by); view.ctx.rotate(ball.rotation - Math.PI / 2);
            if (ballMark.complete && ballMark.naturalWidth) view.ctx.drawImage(ballMark, -size / 2, -size / 2, size, size);
            else drawBallFace(view.ctx, size, '#F8F7F4', '#FF7197');
            view.ctx.restore();
          }
        }
        return { width, height, colors };
      }
      view.badgeCtx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); view.badgeCtx.clearRect(0, 0, 1000, 600);
      view.ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); view.ctx.clearRect(0, 0, 1000, 600);
      fx.rinkCache = drawRinkLayer(view.ctx, width, height, P, ububallMatch, colors, rinkLogo, fx.rinkCache, doc);
      // The ice stands empty while the cast is away (the team setup shot).
      if (view.castHidden) return;
      drawFieldUnder(colors);
      if (!view.field) drawFoulFocus(text);
      if (phase === 'plan') {
        drawPrediction(home, away);
        drawPredictedGoalGlow(home, away);
      }
      if (!bench?.flags.noTrails) drawTrails(view.ctx, fx.trails, view.bodies, home, away, ballHeat);
      drawGuides(home, away, text, playback ? playback.guide : getGuide());
      fx.shockwaves.forEach(s => {
        const progress = 1 - Math.max(0, s.life / s.duration);
        const expand = (s.dramatic || s.hipClip || s.check || s.spinStrike || s.koCone) ? 1 - (1 - progress) ** 2.6 : progress;
        const fade = (s.dramatic || s.hipClip || s.check || s.spinStrike || s.koCone) ? (1 - progress) ** 1.25 : 1 - progress;
        const r = s.currentRadius + (s.maxRadius - s.currentRadius) * expand;
        const targetCtx = s.overlay && view.badgeCtx ? view.badgeCtx : view.ctx;
        const waveColor = s.color || (s.team === 0 ? home : away);
        const baseW = s.width || (s.overlay ? 4.5 : 6);
        targetCtx.save();
        if (s.koCone) {
          const dir = s.normalAngle || 0;
          const halfArc = 0.56 + 0.24 * expand;
          targetCtx.lineCap = 'round';
          targetCtx.beginPath();
          targetCtx.arc(s.x, s.y, r, dir - halfArc, dir + halfArc);
          targetCtx.strokeStyle = waveColor;
          targetCtx.lineWidth = Math.max(1.5, baseW * fade);
          targetCtx.globalAlpha = Math.max(0, fade * 0.92);
          targetCtx.stroke();
          if (fade > 0.2) {
            targetCtx.beginPath();
            targetCtx.arc(s.x, s.y, Math.max(2, r - 2), dir - halfArc * 0.65, dir + halfArc * 0.65);
            targetCtx.strokeStyle = '#ffffff';
            targetCtx.lineWidth = Math.max(1, baseW * 0.42 * fade);
            targetCtx.globalAlpha = Math.max(0, fade * 0.85);
            targetCtx.stroke();
          }
          targetCtx.restore();
          return;
        }
        if (s.spinStrike) {
          const blades = s.blades || 3;
          const dir = s.spinDir || 1;
          const rot = (s.startAngle || 0) + dir * (1 - (1 - progress) ** 1.75) * 2.55;
          const arcSweep = (blades === 3 ? 1.42 : 1.72) * (0.78 + 0.22 * fade) * dir;
          const bladeW = Math.max(1.4, baseW * (0.45 + 0.55 * fade));
          const peakAlpha = Math.max(0, fade * 0.94);
          for (let bIdx = 0; bIdx < blades; bIdx++) {
            const a0 = rot + (bIdx * Math.PI * 2) / blades;
            fillTaperedSpinArc(targetCtx, s.x, s.y, r, a0, arcSweep, bladeW, waveColor, peakAlpha);
            if (fade > 0.2) {
              fillTaperedSpinArc(targetCtx, s.x, s.y, Math.max(2, r - 1.2), a0 + arcSweep * 0.28, arcSweep * 0.68, bladeW * 0.48, '#ffffff', peakAlpha * 0.82);
            }
          }
          targetCtx.restore();
          return;
        }
        if (s.hipClip || s.check) {
          const secondColor = (s.teamB ?? (1 - s.team)) === 0 ? home : away;
          const str = s.strength ?? 1;
          const sweep = s.hipClip
            ? (s.tangent || 0) + expand * (0.45 + 0.50 * str)
            : (s.normalAngle || 0);
          const halfArc = s.hipClip ? (0.32 + 0.50 * str) : (0.28 + 0.48 * str);
          targetCtx.lineCap = 'round';
          for (let side = 0; side < 2; side++) {
            const a0 = sweep + side * Math.PI - halfArc, a1 = sweep + side * Math.PI + halfArc;
            targetCtx.beginPath();
            targetCtx.arc(s.x, s.y, r, a0, a1);
            targetCtx.strokeStyle = side === 0 ? waveColor : secondColor;
            targetCtx.lineWidth = Math.max(1.2, baseW * fade);
            targetCtx.globalAlpha = Math.max(0, fade * (0.55 + 0.37 * str));
            targetCtx.stroke();
            if (fade > 0.2 && str > 0.25) {
              targetCtx.beginPath();
              targetCtx.arc(s.x, s.y, Math.max(1, r - 1.5), a0 + halfArc * 0.22, a1 - halfArc * 0.14);
              targetCtx.strokeStyle = '#ffffff';
              targetCtx.lineWidth = Math.max(1, baseW * 0.4 * fade);
              targetCtx.globalAlpha = Math.max(0, fade * 0.8 * str);
              targetCtx.stroke();
            }
          }
          targetCtx.restore();
          return;
        }
        if (s.band) {
          targetCtx.beginPath();
          targetCtx.arc(s.x, s.y, r, 0, Math.PI * 2);
          targetCtx.strokeStyle = waveColor;
          targetCtx.lineWidth = Math.max(2, baseW * 2.4 * fade);
          targetCtx.globalAlpha = Math.max(0, fade * 0.28);
          targetCtx.stroke();
        }
        targetCtx.beginPath();
        targetCtx.arc(s.x, s.y, r, 0, Math.PI * 2);
        targetCtx.strokeStyle = waveColor;
        targetCtx.lineWidth = Math.max(1, baseW * fade);
        targetCtx.globalAlpha = Math.max(0, fade * (s.overlay ? 0.92 : 1));
        targetCtx.stroke();
        if (s.band && fade > 0.15) {
          targetCtx.beginPath();
          targetCtx.arc(s.x, s.y, Math.max(1, r - baseW * 0.25 * fade), 0, Math.PI * 2);
          targetCtx.strokeStyle = '#ffffff';
          targetCtx.lineWidth = Math.max(1, baseW * 0.38 * fade);
          targetCtx.globalAlpha = Math.max(0, fade * 0.85);
          targetCtx.stroke();
        }
        targetCtx.restore();
      });

      const scoringPlayer = getScoringPlayer();
      const goalReplay = getGoalReplay();
      const onlineReplay = getOnlineReplay();
      const skaters = getSkaters();
      const fwActive = fx.fireWarp && fx.fireWarp.life > 0 && !isReducedMotion() ? fx.fireWarp : null;
      const koActive = fx.koWarp && fx.koWarp.life > 0 && !isReducedMotion() ? fx.koWarp : null;

      view.bodies.slice(0, 6).forEach((b, i) => {
        const reachR = Math.max(b.radius, b.reach || b.radius, 18);
        const isSuperReady = (b.meter >= 100) || Boolean(b.superArm) || Boolean(b.superActive);
        const isFwWarped = Boolean(fwActive && fwActive.ubuIndex === i);
        const isKoWarped = Boolean(koActive && (koActive.attackerIdx === i || koActive.targetIdx === i));
        const ubuWarped = isFwWarped || isKoWarped;
        let ubuWarpAngle = 0, ubuScaleX = 1, ubuScaleY = 1;
        if (ubuWarped) {
          const wSrc = isKoWarped ? koActive : fwActive;
          const wp = 1 - Math.max(0, wSrc.life / wSrc.duration);
          const env = (1 - wp) * Math.cos(wp * Math.PI * 2.2);
          const amt = env * (isKoWarped ? (koActive.targetIdx === i ? 0.08 : 0.055) : 0.065);
          ubuScaleX = 1 - amt;
          ubuScaleY = 1 + amt;
          ubuWarpAngle = Math.atan2(wSrc.ny || 0, wSrc.nx || 1);
          view.ctx.save();
          view.ctx.translate(b.x, b.y);
          view.ctx.rotate(ubuWarpAngle);
          view.ctx.scale(ubuScaleX, ubuScaleY);
          view.ctx.rotate(-ubuWarpAngle);
          view.ctx.translate(-b.x, -b.y);
        }

        if (isSuperReady) {
          const activeKey = b.superActive || b.equippedSuper?.key || 'stalwart';
          drawSuperAura(b, activeKey, reachR);
          if (phase === 'plan' && b.superArm && activeKey === 'colossus') {
            view.ctx.save();
            view.ctx.setLineDash([5, 5]);
            circle(b.x, b.y, Math.max(b.baseRadius ?? b.radius, P.SUPER?.colossusRadius || 56.25), '#ffe043cc', 2);
            view.ctx.restore();
          }
          drawSuperBadge(b, activeKey);
        }

        if (!b.carded) circle(b.x, b.y, reachR + 2, i < 3 ? home : away, 4);

        if ((phase === 'goal' || (onlineReplay?.goalPlayed && phase === 'play')) && b === scoringPlayer) {
          const goalAccent = b.team === 0 ? home : away;
          circle(b.x, b.y, b.radius + 9, goalAccent, 4);
          circle(b.x, b.y, b.radius + 15, goalAccent, 2);
        }
        if (ubuWarped) view.ctx.restore();

        const inAction = phase === 'play' || phase === 'replay' || Boolean(goalReplay);
        if (inAction && !b.carded && !isReducedMotion()) {
          const draft = P.tailgateFactor ? P.tailgateFactor(view.bodies, b) : 0;
          if (draft > 0.22) drawTailgateCone(b, draft);
        }
        if ((inAction && b.guarding) || (phase === 'plan' && i < 3 && fieldPlans[i]?.guard)) {
          const iron = phase === 'plan'
            ? Boolean(predictionCache?.data.guards.some(g => g.index === i && g.held))
            : Boolean(b.ironGuard);
          drawGuardShield(view.badgeCtx, b, view.portrait, iron);
        }

        const slow = P.dazeSlow(b);
        if (slow > 0 && !b.stunned) {
          const depth = slow / P.DAZE.max, spin = isReducedMotion() ? 0 : clockNow() / 300;
          view.ctx.save();
          view.ctx.translate(view.portrait ? b.x + b.radius + 12 : b.x, view.portrait ? b.y : b.y - b.radius - 12);
          view.ctx.rotate(spin); view.ctx.globalAlpha = .55 + .45 * depth;
          view.ctx.strokeStyle = '#c3cbff'; view.ctx.lineWidth = 2; view.ctx.lineCap = 'round';
          view.ctx.beginPath();
          for (let a = 0; a <= Math.PI * 3.5; a += .2) {
            const r = 1 + a * (.7 + .4 * depth);
            if (a) view.ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else view.ctx.moveTo(r, 0);
          }
          view.ctx.stroke(); view.ctx.restore();
        }
        if ((b.stunned || b.stunnedNext) && !b.carded) {
          view.ctx.save();
          if (view.portrait) {
            view.ctx.translate(b.x + b.radius + 14, b.y);
            view.ctx.rotate(Math.PI / 2);
          } else {
            view.ctx.translate(b.x, b.y - b.radius - 10);
          }
          view.ctx.scale(18 / 24, 18 / 24);
          view.ctx.translate(-12, -12);
          view.ctx.fillStyle = '#ffe043';
          view.ctx.strokeStyle = '#101112';
          view.ctx.lineWidth = 2;
          view.ctx.lineJoin = 'round';
          view.ctx.stroke(STUN_STARS);
          view.ctx.fill(STUN_STARS);
          view.ctx.restore();
        }
        if (b.superActive === 'magnet') {
          const ball = view.bodies[6];
          const dx = b.x - ball.x, dy = b.y - ball.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < 260 * 260) {
            const dist = Math.sqrt(distSq) || 1;
            const closeness = Math.max(0, Math.min(1, 1 - dist / 260));
            const ux = dx / dist, uy = dy / dist;
            const px = -uy, py = ux;
            const animSec = isReducedMotion() ? 0 : (fx.heatTime || 0);
            view.ctx.save();
            view.ctx.setLineDash([4, 6]);
            line(b.x, b.y, ball.x, ball.y, '#3388ffcc', 2.2 + closeness * 1.1);
            view.ctx.setLineDash([]);
            for (let side = -1; side <= 1; side += 2) {
              const bow = side * (8 + 10 * closeness) * Math.sin(animSec * 6 + side);
              const mx = (ball.x + b.x) * 0.5 + px * bow;
              const my = (ball.y + b.y) * 0.5 + py * bow;
              view.ctx.beginPath();
              view.ctx.moveTo(ball.x, ball.y);
              if (typeof view.ctx.quadraticCurveTo === 'function') {
                view.ctx.quadraticCurveTo(mx, my, b.x, b.y);
              } else {
                view.ctx.lineTo(b.x, b.y);
              }
              view.ctx.strokeStyle = side < 0 ? '#3388ff66' : '#ff334466';
              view.ctx.lineWidth = 1.5;
              view.ctx.stroke();
            }
            const chevCount = 4;
            const pullAng = Math.atan2(dy, dx);
            for (let c = 0; c < chevCount; c++) {
              const t = ((c / chevCount) + animSec * (1.8 + 1.4 * closeness)) % 1;
              if (t < 0.12 || t > 0.88) continue;
              const cx = ball.x + dx * t;
              const cy = ball.y + dy * t;
              const fade = Math.sin(t * Math.PI);
              const span = 5.5 + 3.5 * (1 - t);
              view.ctx.save();
              view.ctx.translate(cx, cy);
              view.ctx.rotate(pullAng);
              view.ctx.beginPath();
              view.ctx.moveTo(-span * 0.75, -span);
              view.ctx.lineTo(span * 0.45, 0);
              view.ctx.lineTo(-span * 0.75, span);
              view.ctx.strokeStyle = c % 2 === 0 ? '#7ec8ff' : '#ff6b7a';
              view.ctx.lineWidth = 2.1;
              view.ctx.lineCap = 'round';
              view.ctx.lineJoin = 'round';
              view.ctx.globalAlpha = fade * (0.5 + 0.45 * closeness);
              view.ctx.stroke();
              view.ctx.restore();
            }
            view.ctx.restore();
          }
        }
        if (i < 3 && phase === 'plan') drawImpulse(b, fieldPlans[i], home);
        if (view.field || !skaters[i] || bench?.flags.noDomSkaters) return;
        const style = skaters[i].style;
        const wPct = b.radius / 5 + '%';
        const opacity = b.carded ? '0.3' : b.superActive === 'ghost' ? '0.45' : '1';
        const filter = (b.stunned || b.stunnedNext) && !b.carded ? 'grayscale(0.8) brightness(0.7)' : '';
        const rot = b.rotation + (view.portrait ? Math.PI / 2 : 0);
        const transform = ubuWarped
          ? `translate(${b.x / 1000 * renderWidth}px, ${b.y / 600 * renderHeight}px) translate(-50%, -50%) rotate(${ubuWarpAngle}rad) scale(${ubuScaleX.toFixed(4)}, ${ubuScaleY.toFixed(4)}) rotate(${rot - ubuWarpAngle}rad)`
          : `translate(${b.x / 1000 * renderWidth}px, ${b.y / 600 * renderHeight}px) translate(-50%, -50%) rotate(${rot}rad)`;

        let prev = skaterStyleCache.get(skaters[i]);
        if (!prev) { prev = {}; skaterStyleCache.set(skaters[i], prev); }
        if (prev.width !== wPct) { prev.width = wPct; style.width = wPct; }
        if (prev.opacity !== opacity) { prev.opacity = opacity; style.opacity = opacity; }
        if (prev.filter !== filter) { prev.filter = filter; style.filter = filter; }
        if (prev.transform !== transform) { prev.transform = transform; style.transform = transform; }
      });

      const holding = P.holder?.(view.bodies);
      if (holding && view.bodies[6]) drawStickyTether(holding, view.bodies[6]);

      if (phase === 'plan') {
        const b = view.bodies[getSelected()];
        if (b) circle(b.x, b.y, b.radius + 8, text, 2);
      }

      function drawHeatMirage(cx, cy, mirageR, strength, timeVal, isImpact = false) {
        if (strength <= 0.02 || isReducedMotion() || bench?.flags.noMirage) return;
        const sx = width / 1000, sy = height / 600;
        const rx = Math.max(0, cx - mirageR), ry = Math.max(0, cy - mirageR);
        const rw = Math.min(1000 - rx, mirageR * 2), rh = Math.min(600 - ry, mirageR * 2);
        const pw = Math.max(1, Math.round(rw * sx)), ph = Math.max(1, Math.round(rh * sy));
        if (doc?.createElement && view.canvas && pw > 2 && ph > 2) {
          if (!fx.mirageCanvas) {
            fx.mirageCanvas = doc.createElement('canvas');
            fx.mirageCtx = fx.mirageCanvas.getContext('2d');
          }
          const mc = fx.mirageCanvas, mctx = fx.mirageCtx;
          if (mc && mctx) {
            if (mc.width !== pw || mc.height !== ph) { mc.width = pw; mc.height = ph; }
            mctx.clearRect(0, 0, pw, ph);
            const rinkLayer = fx.rinkCache?.layer;
            if (rinkLayer && rinkLayer.width > 0 && rinkLayer.height > 0) {
              const rsx = rinkLayer.width / 1000, rsy = rinkLayer.height / 600;
              mctx.drawImage(rinkLayer, rx * rsx, ry * rsy, rw * rsx, rh * rsy, 0, 0, pw, ph);
            } else {
              mctx.fillStyle = background;
              mctx.fillRect(0, 0, pw, ph);
            }
            const iceLayer = (fx.skids.length || fx.burns.length) ? fx.iceCache?.layer : null;
            if (iceLayer && iceLayer.width > 0 && iceLayer.height > 0) {
              const isx = iceLayer.width / 1000, isy = iceLayer.height / 600;
              mctx.drawImage(iceLayer, rx * isx, ry * isy, rw * isx, rh * isy, 0, 0, pw, ph);
            }
            if (typeof mctx.createRadialGradient === 'function') {
              const gx = (cx - rx) * sx, gy = (cy - ry) * sy, gr = Math.max(4, mirageR * Math.max(sx, sy));
              const glowGrad = mctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
              glowGrad.addColorStop(0, `rgba(255, 176, 84, ${(0.18 * strength).toFixed(3)})`);
              glowGrad.addColorStop(0.55, `rgba(255, 120, 44, ${(0.08 * strength).toFixed(3)})`);
              glowGrad.addColorStop(1, 'rgba(255, 120, 44, 0)');
              mctx.fillStyle = glowGrad;
              mctx.fillRect(0, 0, pw, ph);
            }

            const traceBulbousLobe = (ctx, bx, by, br, t, seed) => {
              ctx.beginPath();
              const steps = 16;
              for (let i = 0; i <= steps; i++) {
                const a = (i / steps) * Math.PI * 2;
                const undulation = 0.18 * Math.sin(a * 3 + t * 4.8 + seed * 1.7)
                                 + 0.10 * Math.cos(a * 2 - t * 3.4 + seed * 2.3);
                const r = br * (1 + undulation);
                const px = bx + Math.cos(a) * r;
                const py = by + Math.sin(a) * r;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
              }
              ctx.closePath();
            };

            // Confine all heat distortion strictly within mirageR
            view.ctx.save();
            view.ctx.beginPath();
            view.ctx.arc(cx, cy, mirageR, 0, Math.PI * 2);
            view.ctx.clip();

            // 1. Central convective plume core lens
            const coreR = mirageR * (isImpact ? 0.42 + timeVal * 0.44 : 0.65);
            const coreZoom = 1 + (isImpact ? 0.085 * strength * Math.cos(timeVal * Math.PI * 1.5) : 0.045 * strength);
            const coreUpdraft = isImpact ? 0 : -1.8 * strength * Math.sin(timeVal * 5.5);
            view.ctx.save();
            traceBulbousLobe(view.ctx, cx, cy, coreR, timeVal, 0);
            view.ctx.clip();
            view.ctx.translate(cx, cy + coreUpdraft);
            view.ctx.scale(coreZoom, coreZoom);
            view.ctx.translate(-cx, -cy);
            view.ctx.globalAlpha = 0.75;
            view.ctx.drawImage(mc, 0, 0, pw, ph, rx, ry, rw, rh);
            view.ctx.restore();

            // 2. Swirling bulbous convective eddies / thermal bubbles
            const numLobes = isImpact ? 6 : 5;
            for (let k = 0; k < numLobes; k++) {
              const swirlSpeed = isImpact ? 12 : 6.5;
              const baseAngle = (k / numLobes) * Math.PI * 2;
              const orbitAngle = baseAngle + timeVal * swirlSpeed * (k % 2 === 0 ? 1.0 : 0.82);
              const orbitR = mirageR * (0.34 + 0.24 * Math.sin(timeVal * 5.2 + k * 1.8));
              const updraft = isImpact ? 0 : (Math.sin(timeVal * 6.5 + k * 2.0) * 0.20 - 0.10) * mirageR;
              const bx = cx + Math.cos(orbitAngle) * orbitR;
              const by = cy + Math.sin(orbitAngle) * orbitR * 0.86 + updraft;
              const br = mirageR * (isImpact ? 0.36 + 0.14 * Math.cos(timeVal * 7 + k) : 0.42 + 0.12 * Math.sin(timeVal * 4.5 + k));

              const lobeZoom = 1 + (isImpact ? 0.065 : 0.038) * strength * (0.85 + 0.35 * Math.sin(timeVal * 6.8 + k * 1.5));
              const swirlDir = k % 2 === 0 ? 1 : -1;
              const tanAngle = Math.atan2(by - cy, bx - cx) + (Math.PI / 2) * swirlDir;
              const drift = (isImpact ? 3.8 : 2.2) * strength;
              const dx = Math.cos(tanAngle) * drift;
              const dy = Math.sin(tanAngle) * drift - (isImpact ? 0 : 1.2 * strength);

              view.ctx.save();
              traceBulbousLobe(view.ctx, bx, by, br, timeVal, k + 1);
              view.ctx.clip();
              view.ctx.translate(bx + dx, by + dy);
              view.ctx.scale(lobeZoom, lobeZoom);
              view.ctx.translate(-bx, -by);
              view.ctx.globalAlpha = 0.65;
              view.ctx.drawImage(mc, 0, 0, pw, ph, rx, ry, rw, rh);
              view.ctx.restore();
            }

            view.ctx.restore();
          }
        }
      }

      const ball = view.bodies[6];
      if (fx.fireWarp && fx.fireWarp.life > 0 && !isReducedMotion()) {
        const fw = fx.fireWarp;
        const wp = 1 - Math.max(0, fw.life / fw.duration);
        const fade = (1 - wp) ** 1.15;
        const mirageR = 46 + wp * 44;
        drawHeatMirage(fw.x, fw.y, mirageR, fade, wp, true);
      }
      if (ball && ballOnFire() && !isReducedMotion()) {
        const fwNear = fx.fireWarp && fx.fireWarp.life > 0 && Math.hypot(ball.x - fx.fireWarp.x, ball.y - fx.fireWarp.y) < 32;
        if (!fwNear) {
          const mirageR = Math.max(26, (ball.radius || 14) * 2.3);
          const heatTime = fx.heatTime || 0;
          drawHeatMirage(ball.x, ball.y, mirageR, 0.5, heatTime, false);
        }
      }
      if (ball) {
        const fw = fx.fireWarp && fx.fireWarp.life > 0 && !isReducedMotion() ? fx.fireWarp : null;
        let warpScaleX = 1, warpScaleY = 1, warpAngle = 0;
        if (fw) {
          const wp = 1 - Math.max(0, fw.life / fw.duration);
          const env = (1 - wp) * Math.cos(wp * Math.PI * 2.2);
          const amt = env * 0.13;
          warpScaleX = 1 - amt;
          warpScaleY = 1 + amt;
          warpAngle = Math.atan2(fw.ny || 0, fw.nx || 1);
          const glowFade = (1 - wp) ** 1.3;
          view.ctx.save();
          view.ctx.translate(fw.x, fw.y);
          view.ctx.rotate(warpAngle);
          view.ctx.scale(1 - (1 - wp) * 0.18, 1 + (1 - wp) * 0.18);
          view.ctx.beginPath();
          view.ctx.arc(0, 0, ball.radius * (1.15 + wp * 1.35), 0, Math.PI * 2);
          view.ctx.fillStyle = '#ff8c24';
          view.ctx.globalAlpha = 0.28 * glowFade;
          view.ctx.fill();
          view.ctx.lineWidth = Math.max(1, 3.2 * glowFade);
          view.ctx.strokeStyle = '#fff0a8';
          view.ctx.globalAlpha = 0.72 * glowFade;
          view.ctx.stroke();
          view.ctx.restore();
        }
        view.ctx.save();
        if (fw) {
          view.ctx.translate(ball.x, ball.y);
          view.ctx.rotate(warpAngle);
          view.ctx.scale(warpScaleX, warpScaleY);
          view.ctx.rotate(-warpAngle);
          view.ctx.translate(-ball.x, -ball.y);
        }
        view.ctx.beginPath(); view.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); view.ctx.fillStyle = background; view.ctx.fill();
        circle(ball.x, ball.y, ball.radius, text, 2);
        const heat = ballHeat(ball), flare = fx.ballFlare || 0, glow = Math.min(1.35, Math.max(0, heat - 1) / 2 + flare * 0.45);
        if (glow > 0) {
          view.ctx.save(); view.ctx.globalAlpha = Math.min(1, .75 * glow); view.ctx.shadowColor = heatColor(Math.max(heat, flare > 0.1 ? 3 : heat)); view.ctx.shadowBlur = bench?.flags.noGlowBlur ? 0 : (16 + flare * 12) * glow * view.canvas.width / 1000;
          view.ctx.beginPath(); view.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); view.ctx.fillStyle = heatColor(Math.max(heat, flare > 0.1 ? 3 : heat)); view.ctx.fill(); view.ctx.restore();
        }
        const size = ball.radius * 1.7;
        const hot = ballOnFire() || (ball.team === -1 && P.ballOnFire?.(ball));
        const paceTeam = ball.strikerTeam;
        if (hot && paceTeam !== undefined && paceTeam >= 0) {
          const teamColor = paceTeam === 0 ? home : away;
          view.ctx.save(); view.ctx.translate(ball.x, ball.y); view.ctx.rotate(ball.rotation + (view.portrait ? Math.PI / 2 : 0));
          drawBallFace(view.ctx, size, teamColor, teamColor);
          view.ctx.restore();
        } else if (ballMark.complete && ballMark.naturalWidth) {
          view.ctx.save(); view.ctx.translate(ball.x, ball.y); view.ctx.rotate(ball.rotation + (view.portrait ? Math.PI / 2 : 0));
          view.ctx.drawImage(ballMark, -size / 2, -size / 2, size, size);
          view.ctx.restore();
        } else {
          view.ctx.save(); view.ctx.translate(ball.x, ball.y); view.ctx.rotate(ball.rotation + (view.portrait ? Math.PI / 2 : 0));
          drawBallFace(view.ctx, size, '#F8F7F4', '#FF7197');
          view.ctx.restore();
        }
        view.ctx.restore();
        view.bodies.slice(0, 6).forEach(b => { if (!b.carded) drawSpin(b, b.team ? away : home); });
        drawSpin(ball, text);
      }

      drawParticles(home, away);
      drawFieldOver(colors);
      drawFouls(text, playback?.viewFouls ?? getFouls());
      drawPopups(view.badgeCtx, fx.popups, view.portrait, width, home, away, isReducedMotion(), doc);
      drawParticles(home, away, true);

      if (goalReplay) {
        view.ctx.save(); view.ctx.translate(view.portrait ? 990 : 500, view.portrait ? 300 : 32); if (view.portrait) view.ctx.rotate(Math.PI / 2);
        view.ctx.font = view.portrait ? 'bold 16px system-ui' : 'bold 18px system-ui'; view.ctx.textAlign = 'center'; view.ctx.textBaseline = 'middle'; view.ctx.fillStyle = text;
        const slow = goalReplay.played >= goalReplay.total || ububallMatch.replaySpeed(goalReplay.total - goalReplay.played) < 1;
        view.ctx.fillText(slow ? 'REPLAY · SLOW MOTION' : 'REPLAY', 0, 0);
        view.ctx.restore();
      }
      return { width, height, colors };
    }

    return {
      rinkLogo,
      ballMark,
      superImages,
      getThemeColors,
      invalidateTheme,
      markIce,
      paceShare,
      ballOnFire,
      quench,
      ballHeat,
      sparkBall,
      flames,
      burnNet,
      lightNet,
      burnIce,
      emitSkaterEffects,
      clearEffects,
      burst,
      steamRing,
      loopFanfare,
      stopFanfare,
      celebrate,
      goalThreat,
      updateEffects,
      addWallEffect,
      popup,
      updatePopups: (dt, popups = getEffects().popups) => updatePopups(dt, popups, isReducedMotion()),
      rounded,
      line,
      circle,
      badgePoint,
      isCreasing,
      stalling,
      cornerTeams,
      offenders,
      foulsShowing,
      cornerWarningY,
      warningAt,
      predictFouls,
      dirtyPrediction,
      predictionKey,
      getPredictionCache,
      paintPrediction,
      drawPrediction,
      drawPredictedGoalGlow,
      drawFouls,
      drawFoulFocus,
      drawSpin,
      drawTailgateCone,
      trailPositions,
      clearDiscontinuousTrails,
      recordTrails,
      drawStickyTether,
      drawSuperAura,
      drawSuperBadge,
      drawParticles,
      drawImpulse,
      drawGuides,
      drawFieldUnder,
      drawFieldOver,
      drawGoalSweep,
      drawGoalCall,
      drawRinkSurface: (g, colors = getThemeColors()) => drawRinkSurface(g, P, ububallMatch, colors, rinkLogo),
      drawPortraitRinkSurface: (g, length = 1000, viewTop = 0, viewSpan = null, colors = getThemeColors()) => drawPortraitRinkSurface(g, P, ububallMatch, colors, rinkLogo, length, viewTop, viewSpan),
      drawScene,
      handleCollision,
      handleWall,
      handleSuper,
      handleShockwave,
      impact,
      dispose
    };
  }

  const api = {
    GOAL_WORDS,
    callText,
    MATERIAL_STYLES,
    SUPER_AURA_THEMES,
    SKID_LIFE,
    SKID_SLOWDOWN,
    BURN_LIFE,
    GOAL_CALL_SECONDS,
    WALL_STEP,
    HEAT_COLORS,
    MAX_CONIC_RING_SPRITES,
    ALERT,
    CHECK,
    IGNITION_FLAME,
    GUARD_SHIELD,
    TARGET_ICON,
    STUN_STARS,
    hexToRgba,
    heatColor,
    createMaterialEmitters,
    createEffectsState,
    createWallRuns,
    explodeShell,
    crackle,
    updateParticles,
    updatePopups,
    drawPopups,
    drawBallFace,
    drawTrails,
    drawGuardShield,
    glowSprite,
    superGlowSprite,
    conicRingSprites,
    conicRingSprite,
    impactStamp,
    impulseGeometry,
    setMeterFill,
    mountSkaterSprites,
    drawRinkSurface,
    drawPortraitRinkSurface,
    drawRinkLayer,
    createRinkPresenter
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ububallPresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
