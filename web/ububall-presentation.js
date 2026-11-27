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
    const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${a < 1e-4 ? 0 : +a.toFixed(4)})`;
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
      ballWarpFlare: 0,
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
      spaceWarps: [],
      contactMarks: [],
      guardFlexes: [],
      guardSetTimes: new Map(),
      ballTapWarp: null,
      lastGuardHitTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      superImpactTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      colossusGrowTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      carveTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      rimSparkTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      wallEffectTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      slipstreamTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      spinStrikeTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      puckSlideTime: -Infinity,
      lastCannonImpact: -Infinity,
      lastFireHitSound: -Infinity,
      stickyHolderIdx: -1,
      materialEmitters: createMaterialEmitters(entries, stylesMap),
      iceCache: {},
      rinkCache: null
    };
  }

  function pushSpaceWarp(fx, x, y, maxRadius, duration, kind, sub = 0, chroma = 1.0, strength = 1.0) {
    if (!fx) return;
    if (!fx.spaceWarps) fx.spaceWarps = [];
    if (fx.spaceWarps.length >= 6) fx.spaceWarps.shift();
    fx.spaceWarps.push({ x, y, maxRadius, duration, life: duration, kind, sub, chroma, strength });
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
      const drag = Math.exp(-dt * (p.drag ?? (p.celebration ? 1.3 : 4)));
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

  function drawGuardShield(badgeCtx, b, isPortrait, iron, scaleMul = 1, nudgeX = 0, nudgeY = 0) {
    badgeCtx.save();
    const p = isPortrait ? { x: b.x - b.radius * .65, y: b.y + b.radius * .65 } : { x: b.x + b.radius * .65, y: b.y + b.radius * .65 };
    badgeCtx.translate(p.x + nudgeX, p.y + nudgeY); if (isPortrait) badgeCtx.rotate(Math.PI / 2);
    const s = 1.1 * scaleMul;
    badgeCtx.scale(s, s); badgeCtx.translate(-12, -12); badgeCtx.fillStyle = iron ? '#c3ccd6' : '#4798ff';
    badgeCtx.fill(GUARD_SHIELD);
    if (iron) {
      badgeCtx.strokeStyle = '#6b7785';
      badgeCtx.lineWidth = 1.5;
      badgeCtx.stroke(GUARD_SHIELD);
    }
    badgeCtx.restore();
  }

  function createRinkPresenter(deps = {}) {
    const bench = typeof window !== 'undefined' && (window.__ubuBench || /[?&]bench(?:=|&|$)/i.test(window.location?.search || ''))
      ? (window.__ubuBench ||= { flags: {}, rec: null }) : null;
    const s = deps.state || deps.session || null;
    const {
      P,
      ububallMatch,
      ububallReplay = root.ububallReplay,
      getView = () => s?.fieldView,
      getEffects = () => s?.fieldEffects,
      getActivePlayback = () => s?.activePlayback ?? null,
      getTheater = () => s?.theater ?? null,
      getPhase = () => s ? (s.cast ? 'cast' : (s.phase ?? 'play')) : 'play',
      getPlans = () => s?.plans ?? [],
      getSelected = () => s?.selected ?? 0,
      getTurn = () => s?.turn ?? 1,
      getElapsed = () => s?.elapsed ?? 0,
      getFouls = () => s?.fouls ?? ububallMatch.newFouls(),
      getFoulInfo = () => s?.foulInfo ?? null,
      getScoringPlayer = () => s?.scoringPlayer ?? null,
      getGoalReplay = () => s?.goalReplay ?? null,
      getOnline = () => s?.online ?? null,
      getOnlineReplay = () => s?.onlineReplay ?? null,
      isCardShot = () => Boolean(s?.cardShot),
      isDragging = () => s ? (s.drag !== null || Boolean(s.dragDirty) || Boolean(s.drawingDragFrame)) : false,
      isMoving = () => s ? (s.phase === 'play' || Boolean(s.postGoal) || Boolean(s.goalReplay) || Boolean((s.activePlayback || s.theater) && !(s.activePlayback || s.theater).paused)) : true,
      getGuide = () => s?.guide ?? null,
      guideShown = () => false,
      getSkaters = () => s?.skaters ?? [],
      getRinkWrap = () => s?.rinkWrap ?? null,
      getRenderSize = s ? () => ({ renderWidth: s.renderWidth, renderHeight: s.renderHeight, deviceWidth: s.deviceWidth, deviceHeight: s.deviceHeight, visibleRinkHeight: s.visibleRinkHeight }) : null,
      isReducedMotion = () => false,
      clockNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      gameAudio = () => null,
      uiScale = () => 1,
      anonymousName = i => `Player ${i + 1}`,
      contactMeter = null,
      setHitStopUntil = s ? until => { s.hitStopUntil = until; } : null,
      onClearPostGoal = s ? () => { s.postGoal = null; } : null,
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
        rinkCacheGen++;
        if (fx) fx.rinkCache = null;
        onAssetLoad?.();
      };
    }

    let themeColors = null, themeObserver = null, darkMedia = null, onDarkChange = null;
    function invalidateTheme() {
      themeColors = null;
      rinkCacheGen++;
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
    const webglApi = deps.ububallWebGL ?? root.ububallWebGL
      ?? (typeof require === 'function' ? (() => { try { return require('./ububall-webgl.js'); } catch { return null; } })() : null);
    const ubuRenderApi = deps.ubuRender ?? root.ubuRender ?? null;
    const forceCanvas2DOption = Boolean(deps.forceCanvas2D);
    const ownedGpuViews = new Set();
    const stampSprites = new Map();
    const entrySpriteCache = new Map();
    let rinkCacheGen = 1;
    let modelObjSeq = 1;
    const modelObjIds = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

    function entrySpriteKey(entry) {
      if (!entry) return null;
      if (entry.dna && (!entry.model || entry.model.dna !== null)) return 'dna:' + entry.dna;
      const m = entry.model;
      if (!m || typeof m !== 'object') return entry.key || null;
      if (modelObjIds) {
        let id = modelObjIds.get(m);
        if (!id) { id = modelObjSeq++; modelObjIds.set(m, id); }
        return 'mdl:' + id;
      }
      return 'mdl:' + (m._spriteSeq ||= modelObjSeq++);
    }

    function getOrBakeEntrySprite(entry) {
      if (!entry?.model || !ubuRenderApi || !doc?.createElement) return null;
      const key = entrySpriteKey(entry);
      if (!key) return null;
      let rec = entrySpriteCache.get(key);
      if (rec) {
        entrySpriteCache.delete(key);
        entrySpriteCache.set(key, rec);
        return rec.canvas || null;
      }
      rec = { canvas: null, promise: null };
      entrySpriteCache.set(key, rec);
      if (entrySpriteCache.size > MAX_SPRITE_CACHE) {
        entrySpriteCache.delete(entrySpriteCache.keys().next().value);
      }
      if (typeof ubuRenderApi.sprite === 'function' && hasImage) {
        rec.promise = Promise.resolve(ubuRenderApi.sprite(entry.model, 256)).then(url => {
          if (!url) return null;
          return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
              const c = doc.createElement('canvas');
              c.width = c.height = 256;
              c.getContext('2d')?.drawImage(img, 0, 0, 256, 256);
              rec.canvas = c;
              onAssetLoad?.();
              resolve(c);
            };
            img.onerror = () => resolve(null);
            img.src = url;
          });
        }).catch(() => null);
      }
      return rec.canvas;
    }

    async function ensureEntrySprites(entries) {
      if (!Array.isArray(entries)) return;
      const tasks = [];
      for (const entry of entries) {
        if (!entry?.model) continue;
        getOrBakeEntrySprite(entry);
        const rec = entrySpriteCache.get(entrySpriteKey(entry));
        if (rec?.promise && !rec.canvas) tasks.append ? tasks.append(rec.promise) : tasks.push(rec.promise);
      }
      if (tasks.length) await Promise.all(tasks);
    }

    function getStampCanvas(key, lw, lh, pxScale, paintFn) {
      if (!doc?.createElement) return null;
      const scale = Math.max(1, Math.min(4, Math.ceil((pxScale || 1) * 2) / 2));
      const fullKey = `${key}@${scale}`;
      const hit = stampSprites.get(fullKey);
      if (hit) {
        stampSprites.delete(fullKey);
        stampSprites.set(fullKey, hit);
        return hit;
      }
      const c = doc.createElement('canvas');
      const pw = Math.max(1, Math.ceil(lw * scale));
      const ph = Math.max(1, Math.ceil(lh * scale));
      c.width = pw; c.height = ph;
      const g = c.getContext?.('2d');
      if (!g || typeof g.save !== 'function') return null;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      paintFn(g, lw, lh, scale);
      const item = { key: fullKey, canvas: c, lw, lh };
      stampSprites.set(fullKey, item);
      if (stampSprites.size > 96) stampSprites.delete(stampSprites.keys().next().value);
      return item;
    }

    function releaseViewGpu(targetView) {
      if (!targetView) return;
      if (targetView._webgl) {
        targetView._webgl.dispose(Boolean(targetView.exporting));
        ownedGpuViews.delete(targetView);
        targetView._webgl = null;
      }
      if (targetView.canvas) targetView.canvas._webglComposite = false;
      if (targetView._fallbackCanvas) {
        targetView._fallbackCanvas.width = targetView._fallbackCanvas.height = 0;
        targetView._fallbackCanvas.remove?.();
        targetView._fallbackCanvas = null;
      }
    }

    function resolveRendererBackend(view) {
      const wantCanvas2D = forceCanvas2DOption
        || Boolean(bench?.flags.forceCanvas2D)
        || (typeof root.location === 'object' && /[?&]renderer=canvas\b/i.test(root.location?.search || ''));

      if (!wantCanvas2D && webglApi?.createSceneRenderer && view?.canvas && typeof view.canvas.getContext === 'function') {
        // Respect pre-bound mock 2D contexts in unit tests unless canvas has not been locked to 2D
        if (!view._webglTried && !view._prebound2D) {
          if (view.ctx) {
            view._prebound2D = true;
          } else {
            view._webglTried = true;
            try {
              const gpu = webglApi.createSceneRenderer(view.canvas, {
                alpha: !view.videoFrame,
                preserveDrawingBuffer: Boolean(view.exporting && !view.videoFrame),
                enableGpuTimer: Boolean(bench || deps.enableGpuTimer),
                onContextLost: () => onAssetLoad?.(),
                onContextRestored: () => onAssetLoad?.()
              });
              if (gpu) {
                view._webgl = gpu;
                ownedGpuViews.add(view);
              }
            } catch {
              view._webgl = null;
            }
          }
        }
      }

      const gpu = !wantCanvas2D && view?._webgl && !view._webgl.isLost ? view._webgl : null;
      const rinkWrap = !view?.field ? getRinkWrap() : null;
      const skaters = getSkaters();
      const skatersParent = skaters?.[0]?.parentElement || (doc?.getElementById ? doc.getElementById('skaters') : null);

      if (gpu) {
        view.canvas._webglComposite = true;
        if (view.canvas.style && view.canvas.style.visibility === 'hidden') view.canvas.style.visibility = '';
        if (view._fallbackCanvas) {
          view._fallbackCanvas.hidden = true;
          if (view._fallbackCanvas.width) view._fallbackCanvas.width = view._fallbackCanvas.height = 0;
        }
        if (!view.field && skatersParent?.style && skatersParent.style.display !== 'none') {
          skatersParent.style.display = 'none';
        }
        if (view.badgeCanvas?.style && view.badgeCanvas.style.display !== 'none') {
          view.badgeCanvas.style.display = 'none';
          if (view.badgeCanvas.width) { view.badgeCanvas.width = 0; view.badgeCanvas.height = 0; }
        }
        return gpu;
      }

      if (view?.canvas) view.canvas._webglComposite = false;
      if (!view?.field && skatersParent?.style) {
        const nextDisp = bench?.flags.noDomSkaters ? 'none' : '';
        if (skatersParent.style.display !== nextDisp) skatersParent.style.display = nextDisp;
      }
      if (view?.badgeCanvas?.style && view.badgeCanvas.style.display === 'none') {
        view.badgeCanvas.style.display = '';
      }

      if (view && view.canvas?.getContext) {
        if (!view._webgl && !view.ctx) {
          view.ctx = view.canvas.getContext('2d');
        }
        if (view._webgl && doc?.createElement) {
          // Canvas previously owned a WebGL2 context (lost or runtime A/B switched to Canvas 2D)
          if (!view._fallbackCanvas) {
            const fb = doc.createElement('canvas');
            fb.className = 'rink-fallback';
            if (fb.style) fb.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;';
            fb.setAttribute?.('aria-hidden', 'true');
            if (rinkWrap?.insertBefore) rinkWrap.insertBefore(fb, view.canvas.nextSibling || null);
            view._fallbackCanvas = fb;
          }
          view._fallbackCanvas.hidden = false;
          if (view.canvas.style) view.canvas.style.visibility = 'hidden';
          view._fallbackCtx ||= view._fallbackCanvas.getContext('2d');
        }
      }
      if (view?._fallbackCanvas && !view._fallbackCanvas.hidden && view._fallbackCtx) {
        view._active2dCanvas = view._fallbackCanvas;
        view.ctx = view._fallbackCtx;
      } else {
        view._active2dCanvas = view?.canvas || null;
      }
      return null;
    }

    function dispose() {
      themeObserver?.disconnect();
      themeObserver = null;
      if (darkMedia && onDarkChange) darkMedia.removeEventListener?.('change', onDarkChange);
      darkMedia = null; onDarkChange = null;
      for (const v of Array.from(ownedGpuViews)) releaseViewGpu(v);
      stampSprites.clear();
      entrySpriteCache.clear();
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
      const moved = Math.hypot(b.x - prev.x, b.y - prev.y);
      if (moved > 60) { s.time = 0; s.path = null; return; }
      const slowed = Math.hypot(prev.vx, prev.vy) - Math.hypot(b.vx, b.vy);
      const stalwartSliding = b.superActive === 'stalwart' && !b.carded && (moved >= 0.5 || Math.hypot(b.vx || 0, b.vy || 0) >= 8);
      if (slowed > SKID_SLOWDOWN || stalwartSliding) {
        const strength = stalwartSliding
          ? Math.max(0.82, Math.min(1, slowed / 600))
          : Math.min(1, slowed / 600);
        Object.assign(s, { time: .3, strength: Math.max(s.time > 0 ? s.strength : 0, strength) });
        if (slowed > SKID_SLOWDOWN) {
          const now = clockNow(), map = (fx.carveTimes ||= new WeakMap());
          if (now - (map.get(b) ?? -Infinity) >= 180) {
            map.set(b, now);
            gameAudio()?.playCarve?.({ volume: Math.min(0.55, 0.18 + 0.36 * strength), speed: Math.hypot(prev.vx, prev.vy), x: b.x, y: b.y });
          }
        }
      }
      if (s.time <= 0) { s.path = null; return; }
      const depth = s.strength * s.time / .3;
      const prevSpd = Math.hypot(prev.vx, prev.vy), curSpd = Math.hypot(b.vx, b.vy);
      const dirDot = prevSpd > 10 && curSpd > 10 ? (prev.vx * b.vx + prev.vy * b.vy) / (prevSpd * curSpd) : 1;
      const turnCut = Math.max(0, Math.min(1, (1 - dirDot) * 1.6));
      const tear = Math.max(0, Math.min(1, Math.max(s.strength * 0.85, turnCut) * (0.4 + 0.6 * (s.time / .3))));
      s.time -= dt;
      if (!s.path) {
        s.path = { points: [{ x: prev.x, y: prev.y, depth, tear }], width: b.radius * 1.7, age: 0 };
        fx.skids.push(s.path); if (fx.skids.length > 30) fx.skids.shift();
      }
      const lastPt = s.path.points[s.path.points.length - 1];
      if (!lastPt || Math.hypot(b.x - lastPt.x, b.y - lastPt.y) >= 1) {
        s.path.points.push({ x: b.x, y: b.y, depth, tear });
      }
      s.path.age = 0;
    }

    const stochasticCount = amount => (amount > 0 ? Math.floor(amount) + (Math.random() < (amount % 1) ? 1 : 0) : 0);

    function flames(x, y, spread, vx, vy, amount, spreadY = spread) {
      const fx = getEffects();
      for (let k = stochasticCount(amount); k > 0 && fx.particles.length < 850; k--) {
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
          fx.ballWarpFlare = 1;
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
      } else if (fx.sizzle) {
        fx.sizzle.stop();
        fx.sizzle = null;
      }
      const level = Math.max(fx.ballFlare, (share - HEAT.red) / (HEAT.redHot - HEAT.red));
      const ux = speed ? ball.vx / speed : 0, uy = speed ? ball.vy / speed : -1;
      if (ballOnFire() && !fx.netFire?.lit) flames(ball.x - ux * ball.radius * .5, ball.y - uy * ball.radius * .5, ball.radius * 1.4, -ball.vx * .12, -ball.vy * .12, dt * 120);
      if (level <= 0 || speed < 1 || fx.netFire?.lit) return;
      const count = stochasticCount(dt * 90 * Math.min(1, level));
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
      const sparks = stochasticCount(dt * 90);
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

    const burnPaceForBall = (ball, minSpeed = 0) => {
      const share = Math.max(paceShare(ball), minSpeed / P.BASE_LAUNCH_SPEED);
      return Math.max(0, Math.min(1, (share - HEAT.sustain) / (2.0 - HEAT.sustain)));
    };
    const emberHeatForSpeed = speed => 0.45 + 0.55 * Math.max(0, Math.min(1, speed));
    const emberCoolRateForSpeed = speed => {
      const s = Math.max(0, Math.min(1, speed));
      return (0.45 + 0.55 * s) / (0.55 * (1 + s));
    };

    function dropPathEmbers(fx, x, y, spread, count, speed = 0) {
      if (isReducedMotion()) return;
      const s = Math.max(0, Math.min(1, speed));
      const colors = ['#fff1c1', '#ffc43d', '#ff942e', '#ff6d1f'];
      for (let k = 0; k < count && fx.particles.length < 850; k++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * spread;
        const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
        const drift = 4 + Math.random() * 14;
        const life = (0.30 + Math.random() * 0.28) * (1 + s);
        fx.particles.push({
          x: px, y: py, px, py,
          vx: Math.cos(ang) * drift, vy: Math.sin(ang) * drift,
          team: -1, color: colors[Math.floor(Math.random() * colors.length)],
          life, duration: life,
          size: (0.85 + Math.random() * 0.55) * (0.8 + 0.35 * s),
          alphaScale: 0.45 + 0.55 * s,
          emberSpark: true
        });
      }
    }

    function burnIce(ball, dt = 1 / 60) {
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
      const pace = burnPaceForBall(ball);
      const speed = Math.max(0, Math.min(1, Math.hypot(ball.vx || 0, ball.vy || 0) / ((P.BASE_LAUNCH_SPEED || 720) * 1.75)));
      const emberHeat = emberHeatForSpeed(speed);
      if (!previous) {
        points.push({ x: ball.x, y: ball.y, depth, pace, speed, heat: emberHeat });
        dropPathEmbers(fx, ball.x, ball.y, ball.radius * 0.55, 2, speed);
      } else if (Math.hypot(ball.x - previous.x, ball.y - previous.y) >= 2) {
        points.push({ x: ball.x, y: ball.y, depth, pace, speed, heat: emberHeat });
        if (Math.random() < 0.25 + 0.55 * speed) dropPathEmbers(fx, ball.x, ball.y, ball.radius * 0.55, 1, speed);
      } else if (points.length === 1 && dt > 0) {
        previous.depth = Math.max(previous.depth, depth);
        previous.pace = Math.max(previous.pace ?? 0, pace);
        previous.speed = speed;
        previous.heat = emberHeat;
        const n = stochasticCount((0.10 + 0.14 * speed) * dt * 60);
        if (n > 0) dropPathEmbers(fx, ball.x, ball.y, ball.radius * 0.55, n, speed);
      }
      fx.burnState.path.age = 0;
    }

    function emitColossusGrowth(fx, body, amount, isBurst = false) {
      if (!fx || !body || isReducedMotion()) return;
      const count = isBurst ? 22 : stochasticCount(amount);
      const r = body.radius || 25;
      const bvx = (body.vx || 0) * 0.42, bvy = (body.vy || 0) * 0.42;
      const colors = ['#ffe043', '#fff5b8', '#ffffff', '#ffbe2e'];
      const phaseOffset = Math.random() * Math.PI * 2;
      for (let k = 0; k < count && fx.particles.length < 520; k++) {
        const ang = isBurst
          ? phaseOffset + (k / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.14
          : Math.random() * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const startR = r * 1.04 + Math.random() * 7;
        const px = body.x + ca * startR, py = body.y + sa * startR;
        const spd = isBurst ? (280 + Math.random() * 160) : (250 + Math.random() * 170);
        const life = isBurst ? (0.30 + Math.random() * 0.14) : (0.24 + Math.random() * 0.14);
        const len = (isBurst ? 19 : 15) + Math.random() * 11;
        fx.particles.push({
          x: px, y: py, px, py,
          vx: bvx + ca * spd, vy: bvy + sa * spd,
          team: body.team,
          color: colors[k % colors.length],
          life, duration: life,
          growthLine: true,
          angle: ang,
          len,
          width: isBurst ? (2.6 + Math.random() * 1.4) : (2.2 + Math.random() * 1.2)
        });
      }
    }

    function emitStickyParticles(fx, x, y, holder, stage, ball = null) {
      if (!fx || isReducedMotion()) return;
      const colors = ['#44dd66', '#d9ffe3', '#7ef29a', '#21845b'];
      const isRelease = stage === 'release';
      const team = holder?.team ?? -1;
      if (fx.particles.length < 520) {
        fx.particles.push({
          x, y, px: x, py: y, vx: 0, vy: 0,
          team: -1, color: isRelease ? '#d9ffe3' : '#44dd66',
          life: 0.15, duration: 0.15,
          flash: true, flashSize: isRelease ? 68 : 78, overlay: true
        });
        const count = isRelease ? 18 : 16;
        const baseVx = (ball?.vx ?? holder?.vx ?? 0) * 0.25;
        const baseVy = (ball?.vy ?? holder?.vy ?? 0) * 0.25;
        const midX = isRelease && holder && ball ? (holder.x + ball.x) * 0.5 : x;
        const midY = isRelease && holder && ball ? (holder.y + ball.y) * 0.5 : y;
        for (let k = 0; k < count && fx.particles.length < 520; k++) {
          const ang = (k / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.32;
          const spd = (isRelease ? 95 : 70) + Math.random() * (isRelease ? 145 : 120);
          const life = 0.22 + Math.random() * 0.18;
          const ox = isRelease && k % 2 === 1 ? midX : x;
          const oy = isRelease && k % 2 === 1 ? midY : y;
          const shape = k % 4 === 0 ? 'streak' : k % 3 === 0 ? 'bubble' : 'circle';
          fx.particles.push({
            x: ox, y: oy, px: ox, py: oy,
            vx: baseVx + Math.cos(ang) * spd,
            vy: baseVy + Math.sin(ang) * spd,
            team,
            color: colors[k % colors.length],
            life, duration: life,
            materialShape: shape,
            angle: ang,
            size: shape === 'streak' ? (2.6 + Math.random() * 1.8) : (2.2 + Math.random() * 2.4),
            snap: shape === 'streak',
            overlay: true
          });
        }
      }
      if (fx.shockwaves.length < 40) {
        fx.shockwaves.push({
          x, y,
          currentRadius: 6,
          maxRadius: isRelease ? 32 : 36,
          team,
          color: isRelease ? '#d9ffe3' : '#44dd66',
          life: 0.20,
          duration: 0.20,
          overlay: true
        });
      }
    }

    function checkStickyRelease(fx, view) {
      if (!fx || fx.stickyHolderIdx < 0 || !view?.bodies?.length) return;
      const holder = P.holder?.(view.bodies);
      const curIdx = holder ? view.bodies.indexOf(holder) : -1;
      if (curIdx !== fx.stickyHolderIdx) {
        const prevHolder = view.bodies[fx.stickyHolderIdx];
        const ball = view.bodies[6];
        if (ball) emitStickyParticles(fx, ball.x, ball.y, prevHolder, 'release', ball);
        fx.stickyHolderIdx = curIdx;
      }
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
                  pushSpaceWarp(fx, midX, midY, 132, 0.58, 2, 0, 1.35, 1.15);
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
        if (b.superActive === 'colossus' && !b.carded && !reduced) {
          const gMap = (fx.colossusGrowTimes ||= new WeakMap());
          const prevP = gMap.get(b) ?? 0;
          const p = P.colossusProgress ? P.colossusProgress(b) : 1;
          if (p < 1 || prevP < 1) {
            const dp = Math.max(0, p - prevP);
            emitColossusGrowth(fx, b, Math.max(dt * 85, dp * 38), false);
            const targetR = Math.max(b.baseRadius ?? b.radius, P.SUPER?.colossusRadius || 56.25);
            for (const gate of [0.28, 0.62, 0.96]) {
              if (prevP < gate && p >= gate && fx.shockwaves.length < 40) {
                const startR = Math.max(b.radius * 0.96, 22);
                fx.shockwaves.push({
                  x: b.x, y: b.y, target: b,
                  currentRadius: startR,
                  maxRadius: Math.max(startR + 34, targetR * (1.28 + gate * 0.24)),
                  team: b.team, color: gate > 0.9 ? '#fff5b8' : '#ffe043',
                  life: 0.32, duration: 0.32,
                  colossusGrowth: true, width: gate > 0.9 ? 3.2 : 2.6,
                  startAngle: gate * 2.1
                });
              }
            }
            gMap.set(b, p);
            if (prevP < 1 && p >= 1) {
              const dentR = targetR * 1.14;
              const startR = targetR * 0.88;
              fx.skids.push({
                dent: true,
                x: b.x,
                y: b.y,
                startR,
                radius: dentR,
                age: 0,
                cracks: buildDentCracks(b.x * 0.13 + b.y * 0.29 + clockNow() * 0.001)
              });
              if (fx.skids.length > 30) fx.skids.shift();
              fx.shake = Math.max(fx.shake || 0, 0.55);
              if (fx.particles.length < 520) {
                fx.particles.push({ x: b.x, y: b.y, px: b.x, py: b.y, vx: 0, vy: 0, team: -1, color: '#ffe043', life: 0.20, duration: 0.20, flash: true, flashSize: 132, overlay: true });
                for (let k = 0; k < 16 && fx.particles.length < 520; k++) {
                  const ang = (k / 16) * Math.PI * 2 + (Math.random() - 0.5) * 0.24;
                  const dist = targetR * (0.72 + Math.random() * 0.38);
                  const px = b.x + Math.cos(ang) * dist, py = b.y + Math.sin(ang) * dist;
                  const spd = 135 + Math.random() * 185, life = 0.24 + Math.random() * 0.20;
                  const isIce = k % 3 !== 0;
                  fx.particles.push({
                    x: px, y: py, px, py,
                    vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
                    team: b.team,
                    color: isIce ? (k % 2 === 0 ? '#e6f4ff' : '#a8d8ff') : (k % 6 === 0 ? '#ffffff' : '#ffe043'),
                    life, duration: life,
                    materialShape: isIce ? (k % 2 === 0 ? 'shard' : 'chip') : 'spark',
                    size: isIce ? (2.4 + Math.random() * 2.2) : (2.8 + Math.random() * 2.0),
                    angle: ang
                  });
                }
              }
            }
          }
        }
        const draft = P.tailgateFactor ? P.tailgateFactor(view.bodies, b) : 0;
        if (draft > 0.32) {
          if (!reduced && draft > 0.35) {
            const s = speed || 1, ux = b.vx / s, uy = b.vy / s;
            const count = stochasticCount(dt * 36 * draft);
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
      checkStickyRelease(fx, view);
      sparkBall(ball, dt);
      burnIce(ball, dt);
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
      fx.danger[0] = fx.danger[1] = fx.ballFlare = fx.ballWarpFlare = fx.kickoffGlow = 0; fx.goalSweep = fx.fireWarp = fx.koWarp = fx.ballTapWarp = null;
      fx.stickyHolderIdx = -1;
      if (fx.spaceWarps) fx.spaceWarps.length = 0;
      if (fx.contactMarks) fx.contactMarks.length = 0;
      if (fx.guardFlexes) fx.guardFlexes.length = 0;
      if (fx.guardSetTimes) fx.guardSetTimes.clear();
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
      fx.colossusGrowTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      fx.carveTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      fx.rimSparkTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      fx.wallEffectTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      fx.slipstreamTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      fx.spinStrikeTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
      fx.lastGuardHitTimes = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
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
      if (moving) {
        for (const s of fieldFx.burns) {
          s.age += dt;
          if (s.poof) {
            if (s.heat > 0) s.heat = Math.max(0, s.heat - dt * emberCoolRateForSpeed(s.speed ?? 0));
          } else if (s.points) {
            for (const p of s.points) if (p.heat > 0) p.heat = Math.max(0, p.heat - dt * emberCoolRateForSpeed(p.speed ?? 0));
          }
        }
      }
      for (let i = fieldFx.burns.length - 1; i >= 0; i--) if (fieldFx.burns[i].age >= BURN_LIFE) fieldFx.burns.splice(i, 1);
      for (const list of [fieldFx.ripples, fieldFx.pings, fieldFx.contactMarks, fieldFx.guardFlexes]) {
        if (!list) continue;
        for (let i = list.length - 1; i >= 0; i--) if ((list[i].life -= dt) <= 0) list.splice(i, 1);
      }
      if (fieldFx.ballTapWarp && (fieldFx.ballTapWarp.life -= dt) <= 0) fieldFx.ballTapWarp = null;
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
      fieldFx.ballWarpFlare = Math.max(0, (fieldFx.ballWarpFlare || 0) - dt / 0.34);
      if (fieldFx.fireWarp && (fieldFx.fireWarp.life -= dt) <= 0) fieldFx.fireWarp = null;
      if (fieldFx.koWarp && (fieldFx.koWarp.life -= dt) <= 0) fieldFx.koWarp = null;
      const tickWarps = list => {
        if (!list?.length) return;
        for (let i = list.length - 1; i >= 0; i--) {
          if ((list[i].life -= dt) <= 0) list.splice(i, 1);
        }
      };
      tickWarps(fieldFx.spaceWarps);
      if (fx !== fieldFx) tickWarps(fx.spaceWarps);
      fieldFx.kickoffGlow = Math.max(0, fieldFx.kickoffGlow - dt / 1.5);
      if (fieldFx.goalSweep && (fieldFx.goalSweep.p += dt / 1.5) >= 1 - 1e-6) fieldFx.goalSweep = null;
      if (fieldFx.goalCall && (fieldFx.goalCall.t += dt) >= GOAL_CALL_SECONDS) fieldFx.goalCall = null;
      checkStickyRelease(fieldFx, view);
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
            const poofSpeed = Math.max(0, Math.min(1, velocity / ((P.BASE_LAUNCH_SPEED || 720) * 1.75)));
            fx.burns.push({ poof: true, x: poofX, y: poofY, radius: 30, age: 0, pace: burnPaceForBall(body, velocity), speed: poofSpeed, heat: emberHeatForSpeed(poofSpeed) });
            if (fx.burns.length > 30) fx.burns.shift();
            dropPathEmbers(fx, poofX, poofY, 20, 4, poofSpeed);
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

    // One feathered profile across the width and around the ends.
    // Five fills cover the sides and caps; per-segment normals with round outer joins
    // and bounded inner miters prevent spikes and bowties on tight curves and bounces.
    // Only cap tails after a fade bucket or when the field settles. Growing slices
    // keep butt joints, so incremental appends never paint overlapping end caps.
    const ICE_FEATHER = [1.5, 1.16, .84, .54, .28];
    const ICE_OPACITY = [.055, .17, .28, .30, .195];
    function pushRibbonJoint(arr, side, pk, rk, t0x, t0y, n0x, n0y, t1x, t1y, n1x, n1y, maxLen) {
      const dot = t0x * t1x + t0y * t1y;
      const cross = t0x * t1y - t0y * t1x;
      if (side * cross < -1e-4 || (dot < -0.999 && Math.abs(cross) <= 1e-4 && side < 0)) {
        const ox0 = side * n0x, oy0 = side * n0y;
        const ox1 = side * n1x, oy1 = side * n1y;
        const ang0 = Math.atan2(oy0, ox0);
        let dAng = Math.atan2(ox0 * oy1 - oy0 * ox1, ox0 * ox1 + oy0 * oy1);
        if (Math.abs(dAng) < 1e-4 && ox0 * ox1 + oy0 * oy1 < -0.9999) dAng = -side * Math.PI;
        const steps = Math.max(1, Math.ceil(Math.abs(dAng) / (Math.PI / 8)));
        for (let s = 0; s <= steps; s++) {
          const a = ang0 + (s / steps) * dAng;
          arr.push([pk.x, pk.y, Math.cos(a) * rk, Math.sin(a) * rk]);
        }
        return;
      }
      if (dot > 0.999) {
        arr.push([pk.x, pk.y, side * n1x * rk, side * n1y * rk]);
        return;
      }
      const denom = 1 + dot;
      if (denom > 0.4) {
        const mx = side * (n0x + n1x) / denom;
        const my = side * (n0y + n1y) / denom;
        const ml = Math.hypot(mx, my);
        if (ml <= 1.8 && ml * rk * Math.sin(Math.acos(Math.min(1, Math.max(-1, dot))) * 0.5) <= maxLen) {
          arr.push([pk.x, pk.y, mx * rk, my * rk]);
          return;
        }
      }
      arr.push([pk.x, pk.y, side * n0x * rk, side * n0y * rk]);
      arr.push([pk.x, pk.y, 0, 0]);
      arr.push([pk.x, pk.y, side * n1x * rk, side * n1y * rk]);
    }

    function softRibbon(points, widthAt, color, prevPoint = null, capEnd = false) {
      if (!points || points.length < 2) return;
      const clean = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const prev = clean[clean.length - 1], cur = points[i];
        const d2 = (cur.x - prev.x) ** 2 + (cur.y - prev.y) ** 2;
        if (d2 >= 0.64 || i === points.length - 1) {
          if (d2 >= 0.04) clean.push(cur);
        }
      }
      const n = clean.length;
      if (n < 2) return;
      const m = n - 1, halfs = new Array(n), hard = bench?.flags.noIceShadow;
      for (let k = 0; k < n; k++) {
        const pt = clean[k];
        const jitter = hard ? 1 : 0.86 + 0.14 * (Math.abs(Math.sin(pt.x * 0.19 + pt.y * 0.31) * 43758.5453) % 1);
        halfs[k] = Math.max(0.5, widthAt(pt) * 0.5 * jitter);
      }
      const tx = new Array(m), ty = new Array(m), nx = new Array(m), ny = new Array(m), slen = new Array(m);
      for (let i = 0; i < m; i++) {
        const dx = clean[i + 1].x - clean[i].x, dy = clean[i + 1].y - clean[i].y;
        const l = Math.hypot(dx, dy) || 1;
        slen[i] = l; tx[i] = dx / l; ty[i] = dy / l; nx[i] = -ty[i]; ny[i] = tx[i];
      }
      let prevTx = 0, prevTy = 0, prevNx = 0, prevNy = 0, hasPrev = false;
      if (prevPoint) {
        const dx = clean[0].x - prevPoint.x, dy = clean[0].y - prevPoint.y;
        const l = Math.hypot(dx, dy);
        if (l >= 0.2) {
          prevTx = dx / l; prevTy = dy / l; prevNx = -prevTy; prevNy = prevTx; hasPrev = true;
        }
      }
      const left = [], right = [];
      if (hasPrev) {
        pushRibbonJoint(left, 1, clean[0], halfs[0], prevTx, prevTy, prevNx, prevNy, tx[0], ty[0], nx[0], ny[0], slen[0]);
        pushRibbonJoint(right, -1, clean[0], halfs[0], prevTx, prevTy, prevNx, prevNy, tx[0], ty[0], nx[0], ny[0], slen[0]);
      } else {
        left.push([clean[0].x, clean[0].y, nx[0] * halfs[0], ny[0] * halfs[0]]);
        right.push([clean[0].x, clean[0].y, -nx[0] * halfs[0], -ny[0] * halfs[0]]);
      }
      for (let k = 1; k < n - 1; k++) {
        const maxL = Math.min(slen[k - 1], slen[k]);
        pushRibbonJoint(left, 1, clean[k], halfs[k], tx[k - 1], ty[k - 1], nx[k - 1], ny[k - 1], tx[k], ty[k], nx[k], ny[k], maxL);
        pushRibbonJoint(right, -1, clean[k], halfs[k], tx[k - 1], ty[k - 1], nx[k - 1], ny[k - 1], tx[k], ty[k], nx[k], ny[k], maxL);
      }
      left.push([clean[n - 1].x, clean[n - 1].y, nx[m - 1] * halfs[n - 1], ny[m - 1] * halfs[n - 1]]);
      right.push([clean[n - 1].x, clean[n - 1].y, -nx[m - 1] * halfs[n - 1], -ny[m - 1] * halfs[n - 1]]);

      const ctx = getView().ctx;
      ctx.save();
      const alpha = ctx.globalAlpha;
      for (let band = 0; band < (hard ? 1 : ICE_FEATHER.length); band++) {
        const scale = hard ? 1 : ICE_FEATHER[band];
        ctx.globalAlpha = alpha * (hard ? 1 : ICE_OPACITY[band]);
        ctx.fillStyle = Array.isArray(color) ? color[band] : color;
        ctx.beginPath();
        const fL = left[0];
        ctx.moveTo(fL[0] + fL[2] * scale, fL[1] + fL[3] * scale);
        for (let k = 1; k < left.length; k++) {
          const e = left[k];
          ctx.lineTo(e[0] + e[2] * scale, e[1] + e[3] * scale);
        }
        if (capEnd) {
          // Nested round caps feather lengthwise using the same five polygon fills.
          const lN = left[left.length - 1];
          const onx = lN[2] * scale, ony = lN[3] * scale;
          ctx.lineTo(lN[0] + (onx + ony) * .7071, lN[1] + (ony - onx) * .7071);
          ctx.lineTo(lN[0] + ony, lN[1] - onx);
          ctx.lineTo(lN[0] + (ony - onx) * .7071, lN[1] - (onx + ony) * .7071);
        }
        for (let k = right.length - 1; k >= 0; k--) {
          const e = right[k];
          ctx.lineTo(e[0] + e[2] * scale, e[1] + e[3] * scale);
        }
        if (!prevPoint) {
          const fR = right[0];
          const rnx = -fR[2] * scale, rny = -fR[3] * scale;
          ctx.lineTo(fR[0] - (rnx + rny) * .7071, fR[1] + (rnx - rny) * .7071);
          ctx.lineTo(fR[0] - rny, fR[1] + rnx);
          ctx.lineTo(fR[0] + (rnx - rny) * .7071, fR[1] + (rnx + rny) * .7071);
        }
        ctx.closePath(); ctx.fill();
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
      ctx.globalAlpha = .20 * fade;
      softRibbon(points, p => s.width * .85 * (.4 + .6 * p.depth) * thin, '#000000', prevPoint, s.age >= .25 || P.settled(getView().bodies));
    }

    function burnPoofStops(fade) {
      return [
        [0.00, `rgba(29, 10, 3, ${(0.56 * fade).toFixed(3)})`],
        [0.30, `rgba(34, 12, 4, ${(0.46 * fade).toFixed(3)})`],
        [0.55, `rgba(45, 17, 5, ${(0.30 * fade).toFixed(3)})`],
        [0.78, `rgba(56, 21, 6, ${(0.12 * fade).toFixed(3)})`],
        [1.00, 'rgba(56, 21, 6, 0)']
      ];
    }

    function paintBurnPoof(ctx, s) {
      const age = Math.floor(s.age * 4) / 4;
      const t = age / BURN_LIFE, fade = 1 - t * t * (3 - 2 * t);
      if (fade <= 0.01) return;
      const paceAlphaScale = 0.92 + 0.24 * (s.pace ?? 0.35);
      const r = s.radius || 30;
      ctx.save();
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      for (const [offset, col] of burnPoofStops(Math.min(1, fade * paceAlphaScale))) grad.addColorStop(offset, col);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Darker reddish-brown ember scorch gradient matching burnPoofStops without a separate core stripe.
    const BURN_COLORS = ['#381506', '#311205', '#290f04', '#220c04', '#1d0a03'];
    function paintBurnSlice(ctx, s, points, prevPoint = null) {
      if (!points || !points.length) return;
      const age = Math.floor(s.age * 4) / 4;
      const t = age / BURN_LIFE, fade = 1 - t * t * (3 - 2 * t);
      if (fade <= 0.005) return;
      let paceSum = 0;
      for (let i = 0; i < points.length; i++) paceSum += points[i].pace ?? 0.35;
      const avgPace = paceSum / points.length;
      const baseAlpha = Math.min(0.75, 0.60 * (0.92 + 0.24 * avgPace)) * fade;
      if (points.length === 1) {
        if (prevPoint) return;
        const p0 = points[0], r0 = Math.max(0.5, s.width * (0.5 + 0.5 * p0.depth) * 0.5);
        const hard = bench?.flags.noIceShadow;
        ctx.save();
        for (let band = 0; band < (hard ? 1 : ICE_FEATHER.length); band++) {
          const scale = hard ? 1 : ICE_FEATHER[band];
          ctx.globalAlpha = baseAlpha * (hard ? 1 : ICE_OPACITY[band]);
          ctx.fillStyle = BURN_COLORS[band];
          ctx.beginPath();
          ctx.arc(p0.x, p0.y, r0 * scale, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        return;
      }
      ctx.globalAlpha = baseAlpha;
      softRibbon(points, p => s.width * (.5 + .5 * p.depth), BURN_COLORS, prevPoint, s.age >= .25 || P.settled(getView().bodies));
    }

    function buildDentCracks(seed = 1) {
      let s = (Math.floor(seed * 99991) || 137) >>> 0;
      const rand = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
      const cracks = [];
      const rays = 10;
      const baseRot = rand() * Math.PI * 2;
      for (let i = 0; i < rays; i++) {
        const ang0 = baseRot + (i / rays) * Math.PI * 2 + (rand() - 0.5) * 0.28;
        const rStart = 0.20 + rand() * 0.24;
        const rEnd = 0.96 + rand() * 0.34;
        const segs = 4;
        const pts = [];
        let curA = ang0;
        for (let k = 0; k <= segs; k++) {
          const u = k / segs;
          const r = rStart + (rEnd - rStart) * u;
          if (k > 0) curA += (rand() - 0.5) * 0.26;
          pts.push([Math.cos(curA) * r, Math.sin(curA) * r]);
        }
        cracks.push({ pts, w: 1.9 + rand() * 0.9 });
        if (i % 2 === 0 || rand() < 0.45) {
          const branchIdx = 1 + Math.floor(rand() * 2);
          const origin = pts[branchIdx];
          const bAng = curA + (rand() < 0.5 ? 1 : -1) * (0.45 + rand() * 0.45);
          const bLen = 0.24 + rand() * 0.26;
          const midA = bAng + (rand() - 0.5) * 0.24;
          cracks.push({
            pts: [
              origin,
              [origin[0] + Math.cos(bAng) * bLen * 0.55, origin[1] + Math.sin(bAng) * bLen * 0.55],
              [origin[0] + Math.cos(midA) * bLen, origin[1] + Math.sin(midA) * bLen]
            ],
            w: 1.2 + rand() * 0.5
          });
        }
      }
      for (let c = 0; c < 3; c++) {
        const a0 = baseRot + c * 2.1 + rand() * 0.8;
        const span = 0.45 + rand() * 0.55;
        const rad = c === 1 ? (0.52 + rand() * 0.12) : (0.82 + rand() * 0.12);
        const pts = [];
        for (let k = 0; k <= 3; k++) {
          const a = a0 + (k / 3) * span;
          const rr = rad + (rand() - 0.5) * 0.06;
          pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
        }
        cracks.push({ pts, w: 1.3 + rand() * 0.5 });
      }
      return cracks;
    }

    function dentRadiusAt(s) {
      const grow = Math.min(1, Math.max(0, (s.age ?? 1) / 0.17));
      const ease = 1 - (1 - grow) ** 2.2;
      const startR = s.startR ?? (s.radius * 0.55);
      return startR + (s.radius - startR) * ease;
    }

    function dentStops(fade) {
      return [
        [0.00, `rgba(0, 0, 0, ${(0.18 * fade).toFixed(3)})`],
        [0.58, `rgba(0, 0, 0, ${(0.24 * fade).toFixed(3)})`],
        [0.84, `rgba(0, 0, 0, ${(0.34 * fade).toFixed(3)})`],
        [0.95, `rgba(0, 0, 0, ${(0.16 * fade).toFixed(3)})`],
        [1.00, 'rgba(0, 0, 0, 0)']
      ];
    }

    function paintDent(ctx, s) {
      const age = s.age < 0.20 ? s.age : Math.floor(s.age * 4) / 4;
      const t = Math.min(1, Math.max(0, age / SKID_LIFE));
      const fade = 1 - t * t * (3 - 2 * t);
      if (fade <= 0.005) return;
      const r = dentRadiusAt(s);
      ctx.save();
      const grad = ctx.createRadialGradient(s.x, s.y, r * 0.12, s.x, s.y, r * 1.12);
      for (const [offset, col] of dentStops(fade)) grad.addColorStop(offset, col);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.12, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(0, 0, 0, ${(0.28 * fade).toFixed(3)})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.94, 0, Math.PI * 2); ctx.stroke();

      ctx.strokeStyle = `rgba(220, 238, 255, ${(0.13 * fade).toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 1.01, 0, Math.PI * 2); ctx.stroke();

      ctx.strokeStyle = `rgba(0, 0, 0, ${(0.16 * fade).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.62, 0, Math.PI * 2); ctx.stroke();

      if (s.cracks?.length) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const crack of s.cracks) {
          const pts = crack.pts;
          if (!pts || pts.length < 2) continue;
          ctx.strokeStyle = `rgba(228, 243, 255, ${(0.15 * fade).toFixed(3)})`;
          ctx.lineWidth = Math.max(0.8, (crack.w || 1.5) * 0.55);
          ctx.beginPath();
          ctx.moveTo(s.x + pts[0][0] * r + 0.9, s.y + pts[0][1] * r + 0.9);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(s.x + pts[k][0] * r + 0.9, s.y + pts[k][1] * r + 0.9);
          ctx.stroke();

          ctx.strokeStyle = `rgba(0, 0, 0, ${(0.44 * fade).toFixed(3)})`;
          ctx.lineWidth = crack.w || 1.5;
          ctx.beginPath();
          ctx.moveTo(s.x + pts[0][0] * r, s.y + pts[0][1] * r);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(s.x + pts[k][0] * r, s.y + pts[k][1] * r);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    const skidBucket = s => (s.dent && s.age < 0.20 ? Math.floor(s.age * 30) : Math.floor(s.age * 4));
    const skidCount = s => (s.dent ? 1 : (s.points?.length || 0));

    function paintIce() {
      const fx = getEffects(), ctx = getView().ctx;
      inRink(() => {
        for (const s of fx.skids) {
          if (s.dent) paintDent(ctx, s);
          else paintSkidSlice(ctx, s, s.points, null);
        }
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
      const settled = P.settled(view.bodies);
      cache.layer ||= doc.createElement('canvas');
      const resized = cache.layer.width !== width || cache.layer.height !== height || cache.shadowFlag !== shadowFlag || cache.settled !== settled;
      const skidSnap = cache.skidSnap, burnSnap = cache.burnSnap;
      let canAppend = !resized && Array.isArray(skidSnap) && Array.isArray(burnSnap)
        && fx.skids.length >= skidSnap.length && fx.burns.length >= burnSnap.length;
      if (canAppend) {
        for (let i = 0; i < skidSnap.length; i++) {
          const prev = skidSnap[i], cur = fx.skids[i];
          const curCount = skidCount(cur);
          if (cur !== prev.ref || skidBucket(cur) !== prev.bucket || curCount < prev.count) {
            canAppend = false;
            break;
          }
        }
      }
      if (canAppend) {
        for (let i = 0; i < burnSnap.length; i++) {
          const prev = burnSnap[i], cur = fx.burns[i];
          const curCount = cur.poof ? 1 : (cur.points?.length || 0);
          if (cur !== prev.ref || Math.floor(cur.age * 4) !== prev.bucket || curCount < prev.count || (!cur.poof && prev.count === 1 && curCount >= 2)) {
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
        cache.settled = settled;
        const main = view.ctx;
        view.ctx = cache.layer.getContext('2d');
        view.ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0);
        view.ctx.clearRect(0, 0, 1000, 600);
        view.ctx.save();
        try { paintIce(); } finally { view.ctx.restore(); view.ctx = main; }
        cache.skidSnap = fx.skids.map(s => ({ ref: s, bucket: skidBucket(s), count: skidCount(s) }));
        cache.burnSnap = fx.burns.map(s => ({ ref: s, bucket: Math.floor(s.age * 4), count: s.poof ? 1 : (s.points?.length || 0) }));
        cache.rebuilds = (cache.rebuilds || 0) + 1;
      } else {
        let hasDelta = fx.skids.length > skidSnap.length || fx.burns.length > burnSnap.length;
        if (!hasDelta) {
          for (let i = 0; i < skidSnap.length; i++) {
            if (skidCount(fx.skids[i]) > skidSnap[i].count) { hasDelta = true; break; }
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
                if (s.dent) {
                  if (prevCount === 0) paintDent(lctx, s);
                  if (i < skidSnap.length) skidSnap[i].count = 1;
                  else skidSnap.push({ ref: s, bucket: skidBucket(s), count: 1 });
                } else {
                  const len = s.points?.length || 0;
                  if (len > prevCount && len >= 2) {
                    if (prevCount < 2) paintSkidSlice(lctx, s, s.points, null);
                    else paintSkidSlice(lctx, s, s.points.slice(prevCount - 1), s.points[prevCount - 2]);
                  }
                  if (i < skidSnap.length) skidSnap[i].count = len;
                  else skidSnap.push({ ref: s, bucket: skidBucket(s), count: len });
                }
              }
              for (let i = 0; i < fx.burns.length; i++) {
                const s = fx.burns[i], prevCount = i < burnSnap.length ? burnSnap[i].count : 0;
                if (s.poof) {
                  if (prevCount === 0) paintBurnPoof(lctx, s);
                  if (i < burnSnap.length) burnSnap[i].count = 1;
                  else burnSnap.push({ ref: s, bucket: Math.floor(s.age * 4), count: 1 });
                } else {
                  const len = s.points?.length || 0;
                  if (len > prevCount && len >= 1) {
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
          for (const s of fx.skids) key += ',' + skidBucket(s) + ':' + (s.dent ? 'd' + Math.round(s.x) + '_' + Math.round(s.y) : ((s.points?.length || 0) >> 3));
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
        const wash = 0.12 * Math.sin(Math.PI * p);
        if (wash > 0.001) { ctx.fillStyle = hexToRgba(color, wash); ctx.fillRect(60, 60, 880, 480); }
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

    // Emit a polyline dash across a list of waypoints [anchor, ...collisionPts, end].
    function pushDashTrail(out, trail, endPt) {
      const len = endPt && endPt !== trail[trail.length - 1] ? trail.length + 1 : trail.length;
      if (len < 2) return;
      for (let i = 0; i < len - 1; i++) {
        const a = trail[i];
        const b = i + 1 < trail.length ? trail[i + 1] : endPt;
        const at = a.tick ?? 0;
        const bt = b.tick ?? 0;
        if (Math.hypot(b.x - a.x, b.y - a.y) > 0.001 || len === 2) {
          out.push(a.x, a.y, at, b.x, b.y, bt);
        }
      }
    }

    // Sample 4-tick dashes & gaps so spacing tracks speed smoothly down to round dots,
    // bending around collisions and clamping slow gaps continuously at minGapPx without integer-tick jumps.
    function buildTickDashes(points, minDashPx, minGapPx) {
      if (!points || points.length < 2) return null;
      const p0 = points[0];
      const x0 = p0.x, y0 = p0.y;
      let moved = false;
      for (let i = 1; i < points.length; i++) {
        const dx = points[i].x - x0, dy = points[i].y - y0;
        if (dx * dx + dy * dy > 0.64) { moved = true; break; }
      }
      if (!moved) return null;

      const DASH_TICKS = 4;
      const GAP_TICKS = 4;
      const out = [];
      let inDash = true;
      let trail = [p0];
      let dashArc = 0;
      let gapArc = 0;
      let segStart = p0;
      let segTickStart = p0.tick ?? 0;
      let targetTick = segTickStart + DASH_TICKS;
      let i = 1;

      while (i < points.length) {
        const p = points[i];
        const pt = p.tick ?? (i * 4);
        const startT = segStart.tick ?? segTickStart;
        const segDt = pt - startT;
        const dx = p.x - segStart.x, dy = p.y - segStart.y;
        const segLen = Math.hypot(dx, dy);

        if (inDash) {
          if (pt + 1e-6 >= targetTick) {
            const frac = segDt > 1e-6 ? Math.max(0, Math.min(1, (targetTick - startT) / segDt)) : 1;
            const endPt = frac >= 1 - 1e-6 ? p : {
              x: segStart.x + dx * frac,
              y: segStart.y + dy * frac,
              tick: targetTick
            };
            dashArc += segLen * frac;
            if (dashArc >= minDashPx) {
              pushDashTrail(out, trail, endPt);
              inDash = false;
              gapArc = 0;
              segTickStart = endPt.tick;
            } else {
              // Still stationary: keep anchor advancing so delayed hits start at impact tick
              trail = [endPt];
              dashArc = 0;
              targetTick = endPt.tick + DASH_TICKS;
            }
            segStart = endPt;
            if (frac >= 1 - 1e-6) i++;
            continue;
          }
          dashArc += segLen;
          if (p.hit) trail.push(p);
          else if (trail.length > 0 && segLen > 0.01 && points[i + 1]) {
            const lastW = trail[trail.length - 1];
            const wdx = p.x - lastW.x, wdy = p.y - lastW.y, wLen = Math.hypot(wdx, wdy);
            const ndx = points[i + 1].x - p.x, ndy = points[i + 1].y - p.y, nLen = Math.hypot(ndx, ndy);
            if (wLen > 0.01 && nLen > 0.01 && (wdx * ndx + wdy * ndy) < 0.995 * wLen * nLen) {
              trail.push(p);
            }
          }
          segStart = p;
          i++;
        } else {
          const gapTargetTick = segTickStart + GAP_TICKS;
          const ft = pt + 1e-6 >= gapTargetTick
            ? (segDt > 1e-6 ? Math.max(0, (gapTargetTick - startT) / segDt) : 0)
            : 2;
          const fd = gapArc + segLen + 1e-6 >= minGapPx
            ? (segLen > 1e-6 ? Math.max(0, (minGapPx - gapArc) / segLen) : 0)
            : 2;
          const frac = Math.max(ft, fd);
          if (frac <= 1 + 1e-6) {
            const cFrac = Math.min(1, frac);
            const endPt = cFrac >= 1 - 1e-6 ? p : {
              x: segStart.x + dx * cFrac,
              y: segStart.y + dy * cFrac,
              tick: startT + segDt * cFrac
            };
            inDash = true;
            trail = [endPt];
            dashArc = 0;
            targetTick = endPt.tick + DASH_TICKS;
            segStart = endPt;
            if (cFrac >= 1 - 1e-6) i++;
            continue;
          }
          gapArc += segLen;
          segStart = p;
          i++;
        }
      }

      const last = points[points.length - 1];
      if (inDash && dashArc >= minDashPx) {
        pushDashTrail(out, trail, last);
      }
      return out.length >= 6 ? new Float32Array(out) : null;
    }

    function getPredictionDashPaths(prediction, bodies) {
      if (prediction._dashPaths && prediction._dashPathsLen === prediction.paths.length) {
        return prediction._dashPaths;
      }
      const dashPaths = prediction.paths.map((points, index) => {
        const isBall = bodies[index].team === -1;
        const lineWidth = isBall ? 2.5 : 2;
        return buildTickDashes(points, 0.05, lineWidth * 2);
      });
      prediction._dashPaths = dashPaths;
      prediction._dashPathsLen = prediction.paths.length;
      return dashPaths;
    }

    function paintPrediction(prediction, home, away) {
      const view = getView(), ctx = view.ctx;
      const dashPaths = getPredictionDashPaths(prediction, view.bodies);
      const invFade = 1 / 240;
      const fadeStartTick = prediction.horizon - 240;
      const QUANT = 16;

      dashPaths.forEach((segs, index) => {
        if (!segs || segs.length < 6) return;
        const isBall = view.bodies[index].team === -1;
        const color = isBall ? '#f2efe9' : view.bodies[index].team === 0 ? home : away;
        const baseAlpha = isBall ? .9 : .65;
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.lineWidth = isBall ? 2.5 : 2;

        let curQ = -1;
        let hasPath = false;
        let prevEndX = NaN, prevEndY = NaN;
        for (let i = 0; i < segs.length; i += 6) {
          const tMid = 0.5 * (segs[i + 2] + segs[i + 5]);
          const fade = tMid <= fadeStartTick ? 1 : Math.max(0, Math.min(1, (prediction.horizon - tMid) * invFade));
          const q = Math.round(fade * QUANT);
          if (q <= 0) continue;
          if (q !== curQ) {
            if (hasPath) ctx.stroke();
            ctx.globalAlpha = (q / QUANT) * baseAlpha;
            ctx.beginPath();
            hasPath = false;
            prevEndX = NaN;
            prevEndY = NaN;
            curQ = q;
          }
          if (segs[i] !== prevEndX || segs[i + 1] !== prevEndY) {
            ctx.moveTo(segs[i], segs[i + 1]);
          }
          ctx.lineTo(segs[i + 3], segs[i + 4]);
          prevEndX = segs[i + 3];
          prevEndY = segs[i + 4];
          hasPath = true;
        }
        if (hasPath) ctx.stroke();
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
        if (p.growthLine) {
          const ang = p.angle || 0;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const halfLen = (p.len || 14) * (0.45 + 0.55 * fade) * 0.5;
          const lw = Math.max(1, (p.width || 2.4) * (0.45 + 0.55 * fade));
          const x0 = p.x - ca * halfLen, y0 = p.y - sa * halfLen;
          const x1 = p.x + ca * halfLen, y1 = p.y + sa * halfLen;
          c.globalAlpha = Math.min(1, fade * 2.2) * 0.92;
          c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
          c.strokeStyle = color; c.lineWidth = lw; c.stroke();
          c.beginPath(); c.moveTo(x0 + ca * halfLen * 0.25, y0 + sa * halfLen * 0.25); c.lineTo(x1, y1);
          c.strokeStyle = '#ffffff'; c.lineWidth = Math.max(0.9, lw * 0.44); c.stroke();
          continue;
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

    function aimCoilPose(b, plan, phase, reduced = false) {
      if (phase !== 'plan' || !b || !plan || plan.guard || b.carded || b.stunned) return null;
      const p = Math.max(0, Math.min(1, Number(plan.power) || 0));
      if (p <= 0.015) return null;
      const rScale = Math.min(1.18, Math.max(0.78, (b.radius || 25) / 25));
      const dist = (1.5 + 3.1 * (p ** 1.12)) * rScale;
      const ang = plan.angle || 0;
      const comp = reduced ? 0 : 0.048 * (p ** 1.15);
      return {
        dx: -Math.cos(ang) * dist,
        dy: -Math.sin(ang) * dist,
        angle: ang,
        power: p,
        scaleX: 1 - comp,
        scaleY: 1 + comp * 0.68
      };
    }

    function guardBadgeMotion(fx, index, b, phase, nowMs) {
      let scale = 1, nx = 0, ny = 0;
      const setInfo = fx?.guardSetTimes?.get?.(index);
      if (setInfo && phase === 'plan') {
        const age = (nowMs - setInfo.at) / 1000;
        if (age >= 0 && age < 0.16) {
          const u = age / 0.16;
          scale *= setInfo.on ? (1 + 0.24 * Math.sin(u * Math.PI) * (1 - u * 0.45)) : (1 - 0.12 * (1 - u));
        } else if (age >= 0.16) {
          fx.guardSetTimes.delete(index);
        }
      }
      if (fx?.guardFlexes?.length) {
        for (let k = fx.guardFlexes.length - 1; k >= 0; k--) {
          const fl = fx.guardFlexes[k];
          if (fl.body === b || (index >= 0 && fl.index === index)) {
            const prog = 1 - Math.max(0, fl.life / fl.duration);
            const env = Math.sin(Math.min(1, prog / 0.32) * Math.PI * 0.5) * ((1 - prog) ** 1.35);
            scale *= 1 + 0.22 * fl.strength * env;
            const recoil = 2.6 * fl.strength * env;
            nx -= Math.cos(fl.angle) * recoil;
            ny -= Math.sin(fl.angle) * recoil;
            break;
          }
        }
      }
      return { scale, nx, ny };
    }

    function triggerGuardToggle(index, on = true) {
      const fx = getEffects(), view = getView();
      const b = view?.bodies?.[index];
      if (fx?.guardSetTimes && index >= 0) {
        fx.guardSetTimes.set(index, { on: Boolean(on), at: clockNow() });
      }
      gameAudio()?.playGuardToggle?.(Boolean(on), b ? { x: b.x, y: b.y } : {});
    }

    function handleLaunch(body, index, kind, preVx, preVy, postVx, postVy, strength = 0.5) {
      if (!body || body.carded) return;
      const fx = getEffects(), audio = gameAudio(), reduced = isReducedMotion();
      if (kind === 'coast') return;
      if (kind === 'brake') {
        const preSpd = Math.hypot(preVx || 0, preVy || 0);
        const s = Math.max(0.2, Math.min(1, strength || preSpd / 550));
        audio?.playUbuMove?.({ id: index, speed: 0 });
        audio?.playCarve?.({ brake: true, speed: preSpd, volume: Math.min(0.78, 0.30 + 0.46 * s), x: body.x, y: body.y });
        if (!reduced && fx) {
          if (index >= 0 && index < 6) {
            const st = fx.skidState[index] ||= { time: 0 };
            Object.assign(st, {
              time: 0.32,
              strength: Math.max(st.time > 0 ? st.strength : 0, 0.72 + 0.28 * s),
              prev: { x: body.x - (preVx || 0) * P.DT * 2.5, y: body.y - (preVy || 0) * P.DT * 2.5, vx: preVx || 0, vy: preVy || 0 }
            });
          }
          const stopAng = Math.atan2(preVy || 0, preVx || 1);
          fx.guardFlexes?.push({
            body, index, angle: stopAng, strength: 0.45 + 0.45 * s, graze: 0,
            iron: Boolean(body.ironGuard), life: 0.19, duration: 0.19
          });
          const count = Math.round(6 + 10 * s);
          for (let k = 0; k < count && fx.particles.length < 400; k++) {
            const ang = stopAng + (Math.random() - 0.5) * 0.92;
            const spd = 85 + 145 * s + Math.random() * 95;
            const life = 0.14 + Math.random() * 0.12;
            const sx = body.x + Math.cos(stopAng) * (body.radius * 0.78) + (Math.random() - 0.5) * 8;
            const sy = body.y + Math.sin(stopAng) * (body.radius * 0.78) + (Math.random() - 0.5) * 8;
            fx.particles.push({
              x: sx, y: sy, px: sx - Math.cos(ang) * 5, py: sy - Math.sin(ang) * 5,
              vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              team: -1, color: k % 3 === 0 ? '#ffffff' : '#d8f1ff',
              life, duration: life,
              materialShape: k < 5 ? 'streak' : undefined,
              size: k < 5 ? 2.1 + Math.random() * 1.2 : 1.7 + Math.random() * 1.3,
              angle: ang, snap: true, overlay: true
            });
          }
        }
        return;
      }
      if (kind === 'cut') {
        const s = Math.max(0.16, Math.min(1, strength || 0.4));
        const postSpd = Math.hypot(postVx || 0, postVy || 0);
        audio?.playCarve?.({ cut: s, speed: Math.max(postSpd, Math.hypot(preVx || 0, preVy || 0)), volume: Math.min(0.68, 0.20 + 0.44 * s), x: body.x, y: body.y });
        if (!reduced && fx) {
          if (index >= 0 && index < 6) {
            const st = fx.skidState[index] ||= { time: 0 };
            Object.assign(st, {
              time: Math.max(st.time || 0, 0.26 + 0.08 * s),
              strength: Math.max(st.time > 0 ? st.strength : 0, 0.52 + 0.42 * s),
              prev: { x: body.x - (preVx || 0) * P.DT * 2, y: body.y - (preVy || 0) * P.DT * 2, vx: preVx || 0, vy: preVy || 0 }
            });
          }
          // Outside-edge snow spray opposite the cut vector
          const sprayAng = Math.atan2((preVy || 0) - (postVy || 0), (preVx || 0) - (postVx || 0));
          const count = Math.round(4 + 9 * s);
          for (let k = 0; k < count && fx.particles.length < 400; k++) {
            const ang = sprayAng + (Math.random() - 0.5) * 0.78;
            const spd = 70 + 125 * s + Math.random() * 85;
            const life = 0.13 + Math.random() * 0.11;
            const sx = body.x + Math.cos(sprayAng) * (body.radius * 0.72);
            const sy = body.y + Math.sin(sprayAng) * (body.radius * 0.72);
            fx.particles.push({
              x: sx, y: sy, px: sx - Math.cos(ang) * 5, py: sy - Math.sin(ang) * 5,
              vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              team: k % 4 === 0 ? body.team : -1,
              color: k % 4 === 0 ? null : (k % 2 === 0 ? '#ffffff' : '#d6eeff'),
              life, duration: life,
              materialShape: k < 4 ? 'streak' : undefined,
              size: 1.8 + Math.random() * 1.2 * s,
              angle: ang, snap: true, overlay: true
            });
          }
        }
      }
    }

    function handleCollision(contact) {
      const { a, b, speed = 0, impulse = 0, plow = false, iron = false, snapped = false, spinStruck = false, struck = false, tangentImpulse = 0, passerSlot = -1, graze: rawGraze = 0, tangentSign: rawTangentSign = 1 } = contact;
      if (iron) {
        if (a?.guarding) a.ironGuard = true;
        if (b?.guarding) b.ironGuard = true;
      }
      const isBall = a.team === -1 || b.team === -1;
      const isSnap = isBall && Boolean(snapped);
      const isStrike = isBall && Boolean(struck || spinStruck);
      const isSpinStrike = isBall && Boolean(spinStruck);
      const isHipClip = !isBall && a.team !== b.team && tangentImpulse >= 55 && tangentImpulse >= speed * 0.22;
      const isCheck = !isBall && a.team !== b.team && !isHipClip && speed >= 65;
      const spinBoost = !isBall && a.team !== b.team ? (tangentImpulse || 0) * 0.45 : 0;
      const graze = isBall ? Math.max(0, Math.min(1, Number(rawGraze) || 0)) : 0;
      const tangentSign = rawTangentSign < 0 ? -1 : 1;
      const grazeSpeedEst = isBall && graze > 0.35 ? speed / Math.max(0.22, Math.sqrt(Math.max(0.04, 1 - graze * graze))) : speed;
      const effSpeed = Math.max(speed, spinBoost, grazeSpeedEst * 0.65);
      if (effSpeed < 15 && !isSnap && !isStrike) return;
      const fx = getEffects(), view = getView();
      const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ballObj = isBall ? (a.team === -1 ? a : b) : null;
      const skaterObj = isBall ? (a.team !== -1 ? a : b) : null;
      // Place ball contact mark on the exact struck edge of the ball (even on extended-Reach poke touches)
      const x = isBall
        ? ballObj.x + (skaterObj.x - ballObj.x) * ballObj.radius / distance
        : a.x + (b.x - a.x) * a.radius / distance;
      const y = isBall
        ? ballObj.y + (skaterObj.y - ballObj.y) * ballObj.radius / distance
        : a.y + (b.y - a.y) * a.radius / distance;
      const normalAngle = Math.atan2(b.y - a.y, b.x - a.x);
      const tangent = normalAngle + Math.PI / 2;
      const sparkStrength = Math.min(1.35, effSpeed / 600);
      if (!isBall || graze < 0.55) {
        burst(x, y, a.team, sparkStrength * (isBall ? (1 - 0.55 * graze) : 1), false, tangent);
        if (a.team !== b.team) burst(x, y, b.team, sparkStrength * (isBall ? (1 - 0.55 * graze) : 1), false, tangent);
      }
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
      if (isStrike && !isReducedMotion()) {
        const ball = a.team === -1 ? a : b;
        const striker = a.team === -1 ? b : a;
        const strikeTeam = striker?.team >= 0 ? striker.team : 0;
        const heading = Math.atan2(ball.vy || 0, ball.vx || 0);
        if (isSpinStrike) {
          const spinVal = ball.omega || -(striker?.omega || 0) || 14;
          const spinDir = Math.sign(spinVal) || 1;
          const ubuSpinDir = Math.sign(striker?.omega || -spinVal) || 1;
          const spinPower = Math.min(1, Math.max(0.35, Math.abs(striker?.omega || spinVal) / 20));
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
            if (striker) {
              const sr = striker.radius || 25;
              fx.shockwaves.push({
                target: striker, x: striker.x, y: striker.y,
                currentRadius: sr * 0.72, maxRadius: sr * 1.54,
                team: strikeTeam, color: null,
                spinTwirl: true, spinDir: ubuSpinDir, startAngle: striker.rotation || heading,
                width: 3.4 + 1.2 * spinPower,
                life: 0.44, duration: 0.44, overlay: true
              });
            }
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
        } else {
          if (fx.shockwaves.length < 30) {
            fx.shockwaves.push({ x: ball.x, y: ball.y, currentRadius: 18, maxRadius: 62, team: strikeTeam, color: null, life: 0.25, duration: 0.25, overlay: true });
            fx.shockwaves.push({ x, y, currentRadius: 11, maxRadius: 42, team: strikeTeam, color: null, life: 0.20, duration: 0.20, overlay: true });
          }
          if (fx.particles.length < 400) {
            fx.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, team: strikeTeam, color: null, life: 0.20, duration: 0.20, flash: true, flashSize: 116, overlay: true });
            fx.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, team: -1, color: '#ffffff', life: 0.11, duration: 0.11, flash: true, flashSize: 56, overlay: true });
          }
          for (let k = 0; k < 14 && fx.particles.length < 400; k++) {
            const ang = heading + (Math.random() - 0.5) * 0.72;
            const spd = 210 + Math.random() * 260;
            const life = 0.18 + Math.random() * 0.12;
            const sx = ball.x + Math.cos(ang) * (ball.radius * 0.65);
            const sy = ball.y + Math.sin(ang) * (ball.radius * 0.65);
            const p = {
              x: sx, y: sy,
              px: sx - Math.cos(ang) * 7, py: sy - Math.sin(ang) * 7,
              vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              team: strikeTeam,
              color: k % 4 === 0 ? '#ffffff' : null,
              life, duration: life, snap: true, overlay: true
            };
            if (k < 6) {
              p.materialShape = 'streak';
              p.size = 2.6 + Math.random() * 1.4;
              p.angle = ang;
            }
            fx.particles.push(p);
          }
        }
      }
      if (plow) flames(x, y, 40, (b.vx || a.vx) * 0.1, (b.vy || a.vy) * 0.1, 15);
      const now = clockNow();
      if (!plow && speed >= 15) contactMeter?.(a, b, speed, passerSlot);
      // Guard Beat 2: braced shield flex & weighted knock whenever a guarding skater absorbs a hit
      const guardNow = clockNow();
      for (const [guarder, other] of [[a, b], [b, a]]) {
        if (!guarder || guarder.team < 0 || !guarder.guarding || plow) continue;
        const hitStr = Math.min(1, Math.max(0.10, Math.max(effSpeed / 540, (impulse || 0) / 860)));
        const hitAng = Math.atan2(other.y - guarder.y, other.x - guarder.x);
        const gIdx = view?.bodies ? view.bodies.indexOf(guarder) : -1;
        if (!isReducedMotion() && fx.guardFlexes && fx.guardFlexes.length < 24) {
          fx.guardFlexes.push({
            body: guarder,
            index: gIdx,
            angle: hitAng,
            strength: hitStr,
            graze,
            iron: Boolean(iron || guarder.ironGuard),
            life: 0.16 + 0.10 * hitStr,
            duration: 0.16 + 0.10 * hitStr
          });
          if (hitStr >= 0.28) {
            const braceBack = hitAng + Math.PI;
            const puffs = Math.round(3 + 6 * hitStr);
            for (let k = 0; k < puffs && fx.particles.length < 400; k++) {
              const ang = braceBack + (Math.random() - 0.5) * 0.85;
              const spd = 48 + 85 * hitStr + Math.random() * 55;
              const life = 0.12 + Math.random() * 0.09;
              const sx = guarder.x + Math.cos(ang) * (guarder.radius * 0.82);
              const sy = guarder.y + Math.sin(ang) * (guarder.radius * 0.82);
              fx.particles.push({
                x: sx, y: sy, px: sx, py: sy,
                vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
                team: -1, color: iron || guarder.ironGuard ? '#e3f4ff' : '#a8d4ff',
                life, duration: life, size: 1.8 + 1.1 * hitStr, snap: true, overlay: true
              });
            }
          }
        }
        const ghMap = (fx.lastGuardHitTimes ||= new WeakMap());
        if (guardNow - (ghMap.get(guarder) ?? -Infinity) > 45) {
          ghMap.set(guarder, guardNow);
          gameAudio()?.playGuardHit?.({
            strength: hitStr,
            graze,
            volume: Math.min(1, 0.30 + 0.70 * (hitStr ** 0.85)),
            x, y
          });
        }
      }

      if (isBall) {
        const ball = a.team === -1 ? a : b;
        const player = a.team !== -1 ? a : b;
        const norm = Math.min(1.0, Math.max(0.0, (Math.max(speed, effSpeed * 0.75) - 20) / 540));
        const volume = Math.min(1.0, 0.15 + 0.85 * (norm ** 0.8));
        const faceAngle = Math.atan2(player.y - ball.y, player.x - ball.x);
        const bodyCoreDist = (player.radius || 25) + (ball.radius || 18);
        const isPoke = distance > bodyCoreDist + 1.2 && (player.reach || player.radius) > (player.radius || 25) + 1.2;

        if (!isReducedMotion()) {
          if (fx.contactMarks && fx.contactMarks.length < 28) {
            const markDur = 0.11 + 0.05 * norm;
            fx.contactMarks.push({
              ball,
              player,
              x, y,
              faceAngle,
              hitAngle: faceAngle + Math.PI,
              strength: Math.max(0.22, norm),
              graze,
              tangentSign,
              poke: isPoke,
              team: player.team,
              life: markDur,
              duration: markDur
            });
          }
          if (graze < 0.50 && !P.ballOnFire?.(ball)) {
            const sq = (1 - graze / 0.50) * (0.35 + 0.65 * norm);
            if (!fx.ballTapWarp || sq >= (fx.ballTapWarp.strength || 0)) {
              fx.ballTapWarp = {
                nx: Math.cos(faceAngle),
                ny: Math.sin(faceAngle),
                strength: sq,
                life: 0.09,
                duration: 0.09
              };
            }
          } else if (graze >= 0.42) {
            const skimDir = faceAngle + tangentSign * (Math.PI * 0.5);
            const skimCount = Math.round(3 + 6 * graze * (0.4 + 0.6 * norm));
            for (let k = 0; k < skimCount && fx.particles.length < 400; k++) {
              const ang = skimDir + (Math.random() - 0.35) * 0.36;
              const spd = 95 + 165 * norm + Math.random() * 95;
              const life = 0.09 + Math.random() * 0.07;
              fx.particles.push({
                x, y,
                px: x - Math.cos(ang) * 6, py: y - Math.sin(ang) * 6,
                vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
                team: k % 3 === 0 ? player.team : -1,
                color: k % 3 === 0 ? null : '#ffffff',
                life, duration: life,
                materialShape: 'streak',
                size: 1.6 + 1.1 * norm,
                angle: ang, snap: true, overlay: true
              });
            }
          }
        }
        if (isStrike && gameAudio()) {
          const sMap = (fx.spinStrikeTimes ||= new WeakMap());
          if (now - (sMap.get(ball) ?? -Infinity) > 50) {
            sMap.set(ball, now);
            const strikeVol = Math.min(1.0, 0.45 + 0.55 * (norm ** 0.8));
            gameAudio().playSpinStrike?.({ volume: strikeVol, spin: ball.omega || player.omega || 14, x, y });
            if (isSpinStrike) {
              gameAudio().playSpinTwirl?.({ volume: strikeVol, spin: player.omega || ball.omega || 14, x: player.x, y: player.y });
            }
          }
        }
        const isFlamingCollision = (plow || P.ballOnFire?.(ball)) && (now - (fx.lastCannonImpact ?? -Infinity) > 20);
        if (isFlamingCollision) {
          fx.ballFlare = Math.max(fx.ballFlare || 0, 0.85);
          fx.ballWarpFlare = 1;
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
          const voiceDuck = isSnap || isSpinStrike ? 1 : (graze > 0.42 ? Math.max(0.14, 1 - (graze - 0.42) * 1.48) : 1);
          if (player.voice && gameAudio() && !(graze > 0.72 && norm < 0.38 && !isSnap && !isSpinStrike)) {
            gameAudio().playCollision(player.voice, { volume: volume * voiceDuck, x, y });
          }
          if (gameAudio()) {
            gameAudio().playBallHit({
              volume: isSnap ? Math.min(1.0, volume * 1.15) : volume,
              snap: isSnap,
              graze,
              poke: isPoke,
              x, y
            });
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
          const sparkMap = (fx.rimSparkTimes ||= (typeof WeakMap !== 'undefined' ? new WeakMap() : new Map()));
          if (now - (sparkMap.get(body) ?? -Infinity) >= 20) {
            sparkMap.set(body, now);
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
        }
        const map = (fx.carveTimes ||= new WeakMap());
        if (now - (map.get(body) ?? -Infinity) >= 180) {
          map.set(body, now);
          gameAudio()?.playCarve?.({ volume: Math.min(0.58, 0.16 + 0.38 * Math.min(1, speed / 550)), speed, rimmed: true, x: cx, y: cy });
        }
        return;
      }
      const wallFxMap = (fx.wallEffectTimes ||= (typeof WeakMap !== 'undefined' ? new WeakMap() : new Map()));
      const prevWallFx = wallFxMap.get(body);
      if (!prevWallFx || prevWallFx.type !== wallType || now - prevWallFx.at >= 16) {
        wallFxMap.set(body, { at: now, type: wallType });
        addWallEffect(body, velocity, wallType, nx, ny);
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
        fx.ballWarpFlare = 1;
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

    function emitCannonJetPuffs(fx, x, y, forwardAng, amountPerSide, minSpd, maxSpd) {
      if (!fx || isReducedMotion()) return;
      const flameCols = ['#fff3b0', '#ffc43d', '#ff7a1a', '#ff3b1a'];
      const count = Math.max(1, Math.round(amountPerSide));
      for (const sign of [-1, 1]) {
        const baseAng = forwardAng + sign * (Math.PI / 4);
        for (let k = 0; k < count && fx.particles.length < 850; k++) {
          const frac = k / Math.max(1, count - 1);
          const ang = baseAng + (Math.random() - 0.5) * 0.50;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const dist = 2 + frac * 34 + (Math.random() - 0.5) * 6;
          const px = x + ca * dist, py = y + sa * dist;
          const spd = minSpd + (maxSpd - minSpd) * frac + (Math.random() - 0.5) * 50;
          const life = 0.14 + Math.random() * 0.14;
          const sizeScale = 1.15 - 0.35 * frac;
          fx.particles.push({
            x: px, y: py, px, py,
            vx: ca * spd,
            vy: sa * spd,
            team: -1,
            color: flameCols[Math.floor(Math.random() * 4)],
            life, duration: life,
            flame: (10 + Math.random() * 12) * sizeScale
          });
        }
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
      if (stage === 'launch' && body && !isReducedMotion() && key === 'colossus') {
        const baseR = body.baseRadius ?? body.radius ?? 25;
        const targetR = Math.max(baseR, P.SUPER?.colossusRadius || 56.25);
        const dentR = targetR * 1.12;
        const startR = Math.max(baseR, 22) * 1.05;
        fx.colossusGrowTimes ||= new WeakMap();
        fx.colossusGrowTimes.set(body, 0);
        if (fx.particles.length < 480) {
          fx.particles.push({ x: body.x, y: body.y, px: body.x, py: body.y, vx: 0, vy: 0, team: -1, color: '#ffe043', life: 0.22, duration: 0.22, flash: true, flashSize: 138, overlay: true });
          for (let k = 0; k < 10 && fx.particles.length < 480; k++) {
            const ang = (k / 10) * Math.PI * 2 + (Math.random() - 0.5) * 0.24;
            const dist = startR * (0.7 + Math.random() * 0.4);
            const px = body.x + Math.cos(ang) * dist, py = body.y + Math.sin(ang) * dist;
            const spd = 120 + Math.random() * 160, life = 0.22 + Math.random() * 0.2;
            fx.particles.push({
              x: px, y: py, px, py,
              vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
              team: body.team,
              color: k % 3 === 0 ? '#ffffff' : '#ffe043',
              life, duration: life,
              materialShape: 'spark',
              size: 2.8 + Math.random() * 2.0,
              angle: ang
            });
          }
        }
        emitColossusGrowth(fx, body, 18, true);
        if (fx.shockwaves.length < 40) {
          fx.shockwaves.push({
            x: body.x, y: body.y, target: body,
            currentRadius: startR, maxRadius: dentR * 1.24,
            team: body.team, color: '#ffe043',
            life: 0.34, duration: 0.34,
            colossusGrowth: true, width: 3.4, startAngle: 0
          });
        }
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
          pushSpaceWarp(fx, x, y, 125, 0.30, 1, 1, 1.25, 1.0);
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
          if (key === 'cannonball') {
            fx.ballFlare = 1;
            fx.ballWarpFlare = 1;
            pushSpaceWarp(fx, x, y, 110, 0.30, 1, 0, 1.0, 0.85);
            const forwardAng = Math.atan2(ny, nx);
            const angL = forwardAng - Math.PI / 4, angR = forwardAng + Math.PI / 4;
            const scorchReach = 46;
            const lx = x + Math.cos(angL) * scorchReach, ly = y + Math.sin(angL) * scorchReach;
            const rx = x + Math.cos(angR) * scorchReach, ry = y + Math.sin(angR) * scorchReach;
            fx.burns.push({
              width: 50,
              age: 0,
              points: [
                { x: lx, y: ly, depth: 0.25, pace: 0.72, speed: 0.85, heat: 0.82 },
                { x, y, depth: 1.0, pace: 0.90, speed: 0.95, heat: 1.0 },
                { x: rx, y: ry, depth: 0.25, pace: 0.72, speed: 0.85, heat: 0.82 }
              ]
            });
            if (fx.burns.length > 30) fx.burns.shift();
            dropPathEmbers(fx, x, y, 24, 6, 0.92);
            dropPathEmbers(fx, (x + lx) * 0.5, (y + ly) * 0.5, 16, 4, 0.86);
            dropPathEmbers(fx, (x + rx) * 0.5, (y + ry) * 0.5, 16, 4, 0.86);
            emitCannonJetPuffs(fx, x, y, forwardAng, 24, 180, 520);
            const bvx = target.vx || 0, bvy = target.vy || 0;
            const bSpd = Math.hypot(bvx, bvy);
            const bAng = bSpd > 1 ? Math.atan2(bvy, bvx) : Math.atan2(dy, dx);
            const smokeBaseSpd = (bSpd > 1 ? bSpd : 700) * 0.5;
            const smokeCols = ['#8e949d', '#a9afb8', '#c2c7cf', '#d6dae0'];
            for (let k = 0; k < 14 && fx.particles.length < 850; k++) {
              const ang = bAng + (Math.random() - 0.5) * 0.44;
              const sSpd = smokeBaseSpd * (0.82 + Math.random() * 0.36);
              const sLife = 0.50 + Math.random() * 0.28;
              const sx = x + Math.cos(ang) * (4 + Math.random() * 10);
              const sy = y + Math.sin(ang) * (4 + Math.random() * 10);
              fx.particles.push({
                x: sx, y: sy, px: sx, py: sy,
                vx: Math.cos(ang) * sSpd,
                vy: Math.sin(ang) * sSpd,
                team: -1,
                color: smokeCols[k % smokeCols.length],
                life: sLife, duration: sLife,
                drag: 1.35,
                materialShape: 'circle',
                size: 4.5 + Math.random() * 5.0
              });
            }
          }
          burst(x, y, body.team, 3.5, false, tangent, color);
          if (fx.shockwaves.length < 32) fx.shockwaves.push({ x, y, currentRadius: 4,
            maxRadius: key === 'cannonball' ? 48 : 36, team: body.team, color, life: .24, duration: .24 });
        } else if (key === 'sticky') {
          emitStickyParticles(fx, x, y, body, 'grab', target);
          fx.stickyHolderIdx = view.bodies ? view.bodies.indexOf(body) : -1;
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
        pushSpaceWarp(fx, source.x, source.y, radius * 1.45, 0.42, 1, 0, 1.15, 1.0);
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

    function drawSceneWebGL(gpu, view, fx, phase, playback, fieldPlans, width, height, isCollectionPortrait, colors) {
      const { primary, text, home, away, border, surface, background } = colors;
      const pxScale = Math.max(0.5, Math.min(4, (view.videoFrame ? view.videoFrame.width / view.videoFrame.logW : (width || 1000) / 1000)));
      const noBlur = Boolean(bench?.flags.noGlowBlur);
      const reduced = isReducedMotion();
      const skaters = getSkaters();

      const resolveSkaterArt = i => {
        const entry = view.entries?.[i];
        const liveNode = skaters?.[i];
        const child = liveNode?.firstChild || liveNode?.querySelector?.('canvas,img') || null;
        if (child && (!view.exporting || !entry)) {
          const tag = child.tagName;
          if (tag === 'CANVAS' && child.width > 0 && child.height > 0) return child;
          if (tag === 'IMG' && child.complete && child.naturalWidth > 0) return child;
        }
        return entry ? getOrBakeEntrySprite(entry) : null;
      };

      const drawBallGlyph = (bx, by, radius, rot, hot, paceTeam) => {
        const size = radius * 1.7;
        gpu.pushTransform();
        gpu.translate(bx, by);
        gpu.rotate(rot);
        if (hot && paceTeam !== undefined && paceTeam >= 0) {
          const tc = paceTeam === 0 ? home : away;
          const face = getStampCanvas(`ballFace:${tc}`, 64, 64, pxScale, g => {
            g.translate(32, 32);
            drawBallFace(g, 56, tc, tc);
          });
          if (face) {
            const drawSz = size * (64 / 56);
            gpu.drawTexture(face.key, face.canvas, -drawSz / 2, -drawSz / 2, drawSz, drawSz, 1);
          }
        } else if (ballMark?.complete && ballMark.naturalWidth) {
          gpu.drawTexture('asset:ballMark', ballMark, -size / 2, -size / 2, size, size, 1);
        } else {
          const face = getStampCanvas('ballFace:default', 64, 64, pxScale, g => {
            g.translate(32, 32);
            drawBallFace(g, 56, '#F8F7F4', '#FF7197');
          });
          if (face) {
            const drawSz = size * (64 / 56);
            gpu.drawTexture(face.key, face.canvas, -drawSz / 2, -drawSz / 2, drawSz, drawSz, 1);
          }
        }
        gpu.popTransform();
      };

      if (isCollectionPortrait) {
        const { length = 1000, viewTop = 0, viewSpan = 1000 } = view.collectionPortrait;
        const L = Math.max(1000, Number(length) || 1000);
        const safeSpan = Math.max(1, viewSpan);
        if (!gpu.beginFrame(width, height, 600, safeSpan, 0, viewTop, false)) return null;

        const topY = 60, bottomY = L - 60, boardH = bottomY - topY;
        const visMin = viewTop - 130, visMax = viewTop + safeSpan + 130;
        const creaseR = ububallMatch.FOULS.crease;
        const zoneOffset = ububallMatch.attackZoneLine(P, 0) - P.rink.left;
        const step = 500 - (topY + zoneOffset);

        // Portrait rounded rink surface & border
        gpu.fillRoundRect(300, topY + boardH * 0.5, 480, boardH, 100, surface, 1, 0);
        gpu.fillRoundRect(300, topY + boardH * 0.5, 480, boardH, 100, border, 1, 4);

        gpu.setClip(3, L);
        if (topY + creaseR >= visMin && topY <= visMax) {
          // Dashed top crease arc
          const segs = 16;
          for (let s = 0; s < segs; s += 2) {
            gpu.strokeArc(300, topY, creaseR, (s / segs) * Math.PI, ((s + 0.45) / segs) * Math.PI, border, 2, 1, false);
          }
        }
        if (bottomY >= visMin && bottomY - creaseR <= visMax) {
          const segs = 16;
          for (let s = 0; s < segs; s += 2) {
            gpu.strokeArc(300, bottomY, creaseR, Math.PI + (s / segs) * Math.PI, Math.PI + ((s + 0.45) / segs) * Math.PI, border, 2, 1, false);
          }
        }

        const firstY = topY + zoneOffset;
        const kStart = Math.max(0, Math.floor((visMin - firstY) / step));
        const kEnd = Math.max(-1, Math.ceil((Math.min(visMax, bottomY - creaseR) - firstY) / step));
        for (let k = kStart; k <= kEnd; k++) {
          const y = firstY + k * step;
          const isCenter = (k % 2) === 1;
          const clearY = isCenter ? bottomY - (creaseR + 90) : bottomY - zoneOffset;
          if (y > clearY + 24) continue;
          const alpha = Math.max(0, Math.min(1, y > clearY ? (clearY + 24 - y) / 24 : 1));
          gpu.strokeLine(60, y, 540, y, border, 2, alpha, false, 6, 10);
          if (isCenter) {
            gpu.fillCircle(300, y, 70, surface, alpha);
            gpu.strokeCircle(300, y, 70, border, 2, alpha);
            if (rinkLogo?.complete && rinkLogo.naturalWidth) {
              const lw = 110, lh = lw * rinkLogo.naturalHeight / rinkLogo.naturalWidth;
              gpu.drawTexture('asset:rinkLogo', rinkLogo, 300 - lw / 2, y - lh / 2, lw, lh, 0.08 * alpha);
            }
          }
        }
        gpu.setClip(0);

        const depth = P.rink.goalDepth;
        if (topY >= visMin && topY - depth <= visMax) {
          gpu.fillRect(230, topY - depth, 140, depth, background, 1);
          gpu.strokeLine(230, topY, 230, topY - depth, away, 4, 1, false);
          gpu.strokeLine(370, topY, 370, topY - depth, away, 4, 1, false);
          gpu.strokeLine(230, topY - depth, 370, topY - depth, away, 4, 1, false);
        }
        if (bottomY + depth >= visMin && bottomY <= visMax) {
          gpu.fillRect(230, bottomY, 140, depth, background, 1);
          gpu.strokeLine(230, bottomY, 230, bottomY + depth, home, 4, 1, false);
          gpu.strokeLine(370, bottomY, 370, bottomY + depth, home, 4, 1, false);
          gpu.strokeLine(230, bottomY + depth, 370, bottomY + depth, home, 4, 1, false);
        }

        if (!view.castHidden) {
          view.bodies.slice(0, 6).forEach((b, i) => {
            const px = b.y, py = 1000 - b.x;
            const reachR = Math.max(b.radius, b.reach || b.radius, 18);
            const teamCol = i < 3 ? home : away;
            if (!b.carded) gpu.strokeCircle(px, py, reachR + 2, teamCol, 4, 1);
            const art = resolveSkaterArt(i);
            const alpha = b.carded ? 0.3 : 1;
            const sz = b.radius * 2;
            if (art) {
              gpu.pushTransform();
              gpu.translate(px, py);
              gpu.rotate(b.rotation - Math.PI / 2);
              gpu.drawTexture(null, art, -sz / 2, -sz / 2, sz, sz, alpha);
              gpu.popTransform();
            } else {
              gpu.fillCircle(px, py, b.radius, view.entries?.[i]?.model?.attributes?.background?.hex || teamCol, alpha);
            }
          });
          const ball = view.bodies[6];
          if (ball) {
            const bx = ball.y, by = 1000 - ball.x;
            gpu.fillCircle(bx, by, ball.radius, background, 1);
            gpu.strokeCircle(bx, by, ball.radius, text, 2, 1);
            drawBallGlyph(bx, by, ball.radius, ball.rotation - Math.PI / 2, false, -1);
          }
        }
        gpu.endFrame();
        return { width, height, colors };
      }

      // Compute active heat refraction sources up front so non-heat frames skip the scene FBO copy entirely
      const heatSources = [];
      if (!view.castHidden && !reduced && !bench?.flags.noMirage) {
        const wMul = bench?.warpScale ?? 1;
        if (fx.fireWarp && fx.fireWarp.life > 0) {
          const fw = fx.fireWarp;
          const wp = 1 - Math.max(0, fw.life / fw.duration);
          const fade = (1 - wp) ** 1.15;
          const mirageR = 46 + wp * 44;
          if (fade * wMul > 0.02) {
            heatSources.push({ x: fw.x, y: fw.y, radius: mirageR, strength: fade * wMul, time: wp, kind: 0, sub: 1, chroma: 1.0 });
          }
        }
        const heatBall = view.bodies[6];
        if (heatBall && ballOnFire()) {
          const fwNear = fx.fireWarp && fx.fireWarp.life > 0 && Math.hypot(heatBall.x - fx.fireWarp.x, heatBall.y - fx.fireWarp.y) < 32;
          if (!fwNear) {
            const mirageR = Math.max(38, (heatBall.radius || 14) * 2.9);
            const flare = Math.max(0, fx.ballWarpFlare || 0);
            const strength = (0.20 + 0.75 * flare) * wMul;
            if (strength > 0.02) {
              heatSources.push({ x: heatBall.x, y: heatBall.y, radius: mirageR, strength, time: fx.heatTime || 0, kind: 0, sub: 0, chroma: 0.4 + 0.8 * flare });
            }
          }
        }
        if (fx.spaceWarps?.length) {
          for (const sw of fx.spaceWarps) {
            if (sw.life <= 0 || heatSources.length >= 6) break;
            const wp = 1 - Math.max(0, sw.life / sw.duration);
            const fade = (1 - wp) ** 1.25;
            const str = (sw.strength ?? 1) * fade * wMul;
            if (str <= 0.02) continue;
            heatSources.push({
              x: sw.x,
              y: sw.y,
              radius: 14 + wp * (sw.maxRadius - 14),
              strength: str,
              time: wp,
              kind: sw.kind,
              sub: sw.sub || 0,
              chroma: sw.chroma ?? 1.0
            });
          }
        }
      }

      const vf = view.videoFrame || null;
      const frameW = vf ? vf.width : width;
      const frameH = vf ? vf.height : height;
      const logW = vf ? vf.logW : 1000;
      const logH = vf ? vf.logH : 600;
      const offX = vf ? vf.offX : 0;
      const offY = vf ? vf.offY : 0;
      if (!gpu.beginFrame(frameW, frameH, logW, logH, offX, offY, heatSources.length > 0, vf ? background : null, reduced ? 0 : (fx.heatTime || 0))) return null;

      // 1. Baked static rink surface texture (invalidated only on resize, theme change, or logo load)
      const logoReady = Boolean(rinkLogo?.complete && rinkLogo.naturalWidth);
      const rinkKey = `${width},${height},${logoReady ? 1 : 0}${JSON.stringify(colors)}`;
      if (fx.rinkCache?.key !== rinkKey && doc?.createElement) {
        const layer = fx.rinkCache?.layer || doc.createElement('canvas');
        layer.width = width; layer.height = height;
        const lctx = layer.getContext('2d');
        lctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0);
        lctx.clearRect(0, 0, 1000, 600);
        drawRinkSurface(lctx, P, ububallMatch, colors, rinkLogo);
        fx.rinkCache = { key: rinkKey, layer, gen: ++rinkCacheGen };
      }
      if (fx.rinkCache?.layer) {
        gpu.drawTexture('rinkSurface', fx.rinkCache.layer, 0, 0, 1000, 600, 1, 0, fx.rinkCache.gen || 1);
      }

      if (view.castHidden) {
        gpu.endFrame();
        return { width, height, colors };
      }

      // 2. Field underlays (kickoffGlow, feathered skids & warm umber-to-soot burns, Pulse tint, danger glow)
      if (fx.kickoffGlow > 0) {
        const kr = 70 + (1 - fx.kickoffGlow) * 10;
        if (!noBlur) gpu.strokeCircle(500, 300, kr, primary, 11, fx.kickoffGlow * 0.28);
        gpu.strokeCircle(500, 300, kr, primary, 3, fx.kickoffGlow);
      }
      if (fx.skids.length || fx.burns.length) {
        const hardIce = Boolean(bench?.flags.noIceShadow);
        gpu.setClip(1);
        for (const s of fx.skids) {
          const t = Math.min(1, Math.max(0, s.age / SKID_LIFE));
          const fade = 1 - t * t * (3 - 2 * t);
          if (fade <= 0.005) continue;
          if (s.dent) {
            const r = dentRadiusAt(s);
            gpu.drawRadialStops(s.x, s.y, r * 1.12, dentStops(fade), 1, 32);
            gpu.strokeCircle(s.x, s.y, r * 0.94, '#000000', 3.2, 0.28 * fade);
            gpu.strokeCircle(s.x, s.y, r * 1.01, '#dceeff', 1.4, 0.13 * fade);
            gpu.strokeCircle(s.x, s.y, r * 0.62, '#000000', 1.6, 0.16 * fade);
            if (s.cracks?.length) {
              for (const crack of s.cracks) {
                const pts = crack.pts;
                if (!pts || pts.length < 2) continue;
                const w = crack.w || 1.5;
                for (let k = 0; k < pts.length - 1; k++) {
                  const x0 = s.x + pts[k][0] * r, y0 = s.y + pts[k][1] * r;
                  const x1 = s.x + pts[k + 1][0] * r, y1 = s.y + pts[k + 1][1] * r;
                  gpu.strokeLine(x0 + 0.9, y0 + 0.9, x1 + 0.9, y1 + 0.9, '#e4f3ff', Math.max(0.8, w * 0.55), 0.15 * fade, true);
                  gpu.strokeLine(x0, y0, x1, y1, '#000000', w, 0.44 * fade, true);
                }
              }
            }
            continue;
          }
          if (!s.points || s.points.length < 2) continue;
          const thin = 0.6 + 0.4 * fade;
          gpu.drawSoftRibbon(s.points, p => s.width * 0.85 * (0.4 + 0.6 * p.depth) * thin, false, fade, hardIce, null, p => p.tear ?? p.depth ?? 0.35);
        }
        for (const s of fx.burns) {
          const t = Math.min(1, Math.max(0, s.age / BURN_LIFE));
          const fade = 1 - t * t * (3 - 2 * t);
          if (fade <= 0.005) continue;
          if (s.poof) {
            const r0 = s.radius || 30;
            gpu.drawSoftRibbon(
              [{ x: s.x, y: s.y, depth: 1, pace: s.pace ?? 0.35, speed: 0.0, heat: s.heat ?? 0 }],
              () => (r0 * 2) / 1.5,
              true,
              fade,
              hardIce,
              p => p.pace,
              p => p.speed,
              p => p.heat
            );
          } else if (s.points && s.points.length >= 1) {
            gpu.drawSoftRibbon(s.points, p => s.width * (0.5 + 0.5 * p.depth), true, fade, hardIce, p => p.pace ?? 0.35, p => p.speed ?? 0.35, p => p.heat ?? 0);
          }
        }
        gpu.setClip(0);
      }
      if (phase === 'plan' && pulseMode() && !P.settled(view.bodies)) {
        gpu.setClip(1);
        gpu.fillRect(60, 60, 880, 480, 'rgba(120,170,255,0.07)', 1);
        gpu.setClip(0);
      }
      fx.danger.forEach((glow, side) => {
        if (glow < 0.02) return;
        const x = side ? 940 : 60, col = side ? away : home;
        const a = Math.min(1, glow) * 0.4;
        if (!noBlur) gpu.strokeLine(x, 230, x, 370, col, 13, a * 0.35);
        gpu.strokeLine(x, 230, x, 370, col, 5, a);
      });

      // 3. Foul Focus Inspector (when foul dialog is open)
      const foulInfo = !view.field ? getFoulInfo() : null;
      if (foulInfo) {
        const foulsCur = getFouls(), amber = '#ffb020';
        const drawFocusLabel = (words, lx, ly) => {
          const st = getStampCanvas(`foulFocus:${words}`, 132, 28, pxScale, g => {
            g.translate(66, 14);
            g.font = '800 14px system-ui, sans-serif';
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.lineWidth = 4; g.strokeStyle = '#101217'; g.strokeText(words, 0, 0);
            g.fillStyle = amber; g.fillText(words, 0, 0);
          });
          if (!st) return;
          gpu.pushTransform();
          gpu.translate(lx, ly);
          if (view.portrait) gpu.rotate(Math.PI / 2);
          gpu.drawTexture(st.key, st.canvas, -st.lw / 2, -st.lh / 2, st.lw, st.lh, 1);
          gpu.popTransform();
        };
        const ubus = view.bodies.slice(0, 6);
        const drawRingList = (list, dashed) => {
          for (const b of list) {
            gpu.strokeCircle(b.x, b.y, Math.max(b.radius, b.reach || b.radius) + 7, dashed ? text : amber, 2.5, 1, dashed ? 4 : 0, dashed ? 5 : 0);
          }
        };
        if (foulInfo.kind === 'crease') {
          const t = foulInfo.team, mouth = t ? 940 : 60, zone = ububallMatch.attackZoneLine(P, t), from = t ? Math.PI / 2 : -Math.PI / 2;
          gpu.setClip(1);
          gpu.fillRect(Math.min(mouth, zone), 60, Math.abs(zone - mouth), 480, amber, 0.10);
          gpu.setClip(0);
          gpu.strokeLine(zone, 60, zone, 540, amber, 2, 0.8);
          gpu.fillArcSector(mouth, 300, ububallMatch.FOULS.crease, from, from + Math.PI, amber, 0.22, 24);
          gpu.strokeArc(mouth, 300, ububallMatch.FOULS.crease, from, from + Math.PI, amber, 2, 0.9);
          gpu.strokeLine(mouth, 300 - ububallMatch.FOULS.crease, mouth, 300 + ububallMatch.FOULS.crease, amber, 2, 0.9);
          drawFocusLabel('Attack zone', (mouth + zone) / 2, view.portrait ? 112 : 80);
          drawFocusLabel('Crease', mouth + (t ? -40 : 40), 300 - ububallMatch.FOULS.crease - 16);
          drawRingList(ubus.filter(b => b.team === t && isCreasing(b, t)), false);
          drawRingList(ubus.filter(b => b.team === 1 - t && ububallMatch.inAttackZone(P, b, t)), true);
        } else {
          const c = foulsCur.corner ?? 0, cx = c % 2 ? 840 : 60, cy = c > 1 ? 440 : 60;
          gpu.setClip(1);
          gpu.fillRect(cx, cy, 100, 100, amber, 0.16);
          gpu.setClip(0);
          gpu.strokeLine(c % 2 ? 840 : 160, cy, c % 2 ? 840 : 160, cy + 100, amber, 2, 0.8, false, 6, 6);
          gpu.strokeLine(cx, c > 1 ? 440 : 160, cx + 100, c > 1 ? 440 : 160, amber, 2, 0.8, false, 6, 6);
          drawFocusLabel('Corner', c % 2 ? 790 : 210, c > 1 ? 430 : 170);
          const [hList, aList] = cornerTeams(foulsCur);
          drawRingList(hList, hList.length <= aList.length);
          drawRingList(aList, aList.length <= hList.length);
        }
      }

      // 4. Planning trajectories, ignition markers, goal beacons, and pulsing goal glow
      const drawPredictionOverlayWebGL = pred => {
        const dashPaths = getPredictionDashPaths(pred, view.bodies);
        dashPaths.forEach((segs, index) => {
          if (!segs || segs.length < 6) return;
          const isBall = view.bodies[index].team === -1;
          const col = isBall ? '#f2efe9' : view.bodies[index].team === 0 ? home : away;
          const baseAlpha = isBall ? 0.9 : 0.65;
          const lw = isBall ? 2.5 : 2;
          gpu.drawFadeSegments(segs, col, lw, baseAlpha, pred.horizon, 240);
        });

        const endTick = pulseMode() ? ububallMatch.turnTicks(view.mode) : 0;
        if (endTick) {
          pred.paths.forEach((points, index) => {
            const k = points.findIndex(p => p.tick >= endTick);
            if (k < 1) return;
            const from = points[k - 1], to = points[k], dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
            if (!d) return;
            const u = (endTick - from.tick) / (to.tick - from.tick), x = from.x + dx * u, y = from.y + dy * u;
            const isBall = view.bodies[index].team === -1, half = isBall ? 6 : 8, nx = -dy / d * half, ny = dx / d * half;
            gpu.strokeLine(x - nx, y - ny, x + nx, y + ny, isBall ? '#f2efe9' : view.bodies[index].team === 0 ? home : away, 2.5, isBall ? 0.95 : 0.8);
          });
        }

        if (pred.ignition) {
          const { x, y, team } = pred.ignition;
          const ic = team === 1 ? away : home;
          const st = getStampCanvas(`ignite:${ic}`, 30, 30, pxScale, g => {
            g.translate(3, 3);
            g.fillStyle = ic; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.lineJoin = 'round';
            g.fill(IGNITION_FLAME); g.stroke(IGNITION_FLAME);
          });
          if (st) {
            gpu.pushTransform();
            gpu.translate(x, y);
            if (view.portrait) gpu.rotate(Math.PI / 2);
            gpu.drawTexture(st.key, st.canvas, -15, -15, 30, 30, 0.95);
            gpu.popTransform();
          }
        }

        if (pred.goalTargets) {
          for (const target of pred.goalTargets) {
            if (target.team >= 0 && !pred.paths[target.index].some(p => Math.hypot(p.x - pred.paths[target.index][0].x, p.y - pred.paths[target.index][0].y) > 3)) continue;
            const col = target.team < 0 ? '#f2efe9' : target.team === 0 ? home : away;
            const st = getStampCanvas(`target:${col}`, 24, 24, pxScale, g => {
              g.translate(12, 12);
              g.beginPath(); g.arc(0, 0, 7.5, 0, Math.PI * 2); g.fillStyle = 'rgba(11, 13, 16, 0.75)'; g.fill();
              g.scale(13 / 24, 13 / 24); g.translate(-12, -12);
              g.lineWidth = 1.8; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = col; g.stroke(TARGET_ICON);
            });
            if (st) {
              gpu.pushTransform();
              gpu.translate(target.x, target.y);
              if (view.portrait) gpu.rotate(Math.PI / 2);
              gpu.drawTexture(st.key, st.canvas, -12, -12, 24, 24, 1);
              gpu.popTransform();
            }
          }
        }

        for (const stop of pred.stops) {
          if (!stop.stopped || !pred.paths[stop.index].some(p => Math.hypot(p.x - stop.x, p.y - stop.y) > 3)) continue;
          if (pred.goalTargets?.some(t => t.index === stop.index && Math.hypot(t.x - stop.x, t.y - stop.y) < 5)) continue;
          const col = view.bodies[stop.index].team < 0 ? '#ffffff' : view.bodies[stop.index].team === 0 ? home : away;
          gpu.strokeLine(stop.x - 4, stop.y - 4, stop.x + 4, stop.y + 4, col, 2, 1);
          gpu.strokeLine(stop.x + 4, stop.y - 4, stop.x - 4, stop.y + 4, col, 2, 1);
        }

        if (pred.impacts && pred.impacts.length > 0) {
          gpu.setClip(2);
          for (const hit of pred.impacts) {
            const team = view.bodies[hit.index].team;
            const col = team < 0 ? '#ffffff' : team === 0 ? home : away;
            const fade = Math.max(0, Math.min(1, (pred.horizon - hit.tick) / 240));
            gpu.fillCircle(hit.x, hit.y, hit.reach, col, 0.2 * fade);
          }
          gpu.setClip(0);
        }
      };

      let predictedGoalBloom = null;
      if (phase === 'plan' && !bench?.flags.noPredictAll) {
        const key = predictionKey();
        const t0 = bench?.rec ? clockNow() : 0;
        if (predictionCache?.key !== key) {
          const data = P.predictTurn(view.bodies, getPlans());
          predictionCache = { key, data, fouls: predictFouls(data) };
        }
        const t1 = bench?.rec ? clockNow() : 0;
        if (!bench?.flags.noPredictLayer) {
          const pred = predictionCache.data;
          drawPredictionOverlayWebGL(pred);

          // Pulsing predicted goal glow (single mitered/rounded-rect SDF strokes to avoid overlapping corner caps)
          if (pred.goal !== null && pred.goalTick != null) {
            const defSide = pred.goal === 1 ? 0 : 1;
            const col = defSide === 0 ? home : away;
            const arrival = pred.goalTick * P.DT;
            const horizon = (pred.horizon || 480) * P.DT;
            const u = Math.max(0, Math.min(1, 1 - arrival / horizon));
            const freq = 1.2 + 4.3 * u;
            const pulse = 0.5 + 0.5 * Math.sin((clockNow() / 1000) * Math.PI * 2 * freq);
            const alpha = Math.min(1, (0.25 + 0.15 * (1 - u)) + ((0.45 + 0.55 * u) - (0.25 + 0.15 * (1 - u))) * pulse);
            const depth = P.rink.goalDepth;
            const mouthX = defSide ? 940 : 60, backX = defSide ? 940 + depth : 60 - depth;
            const goalX = Math.min(mouthX, backX), goalCx = goalX + depth * 0.5;
            gpu.fillRect(goalX, 230, depth, 140, col, (0.04 + 0.16 * u) * (0.6 + 0.4 * pulse));
            const netW = 4.5 + 3.5 * u;
            if (!noBlur) {
              const glowW = netW + 10 + 10 * u * pulse;
              gpu.fillRoundRect(goalCx, 300, depth, 140, 0, col, alpha * 0.24, glowW);
              predictedGoalBloom = { cx: goalCx, depth, col, netW: netW + 4, alpha: alpha * 0.65 };
            }
            gpu.fillRoundRect(goalCx, 300, depth, 140, 0, col, alpha, netW);
          }
        }
        if (bench?.rec) {
          bench.rec.predictSimMs += (t1 - t0);
          bench.rec.predictPaintMs += (clockNow() - t1);
        }
      }

      // 5. Motion trails
      if (!bench?.flags.noTrails) {
        gpu.drawTrails(fx.trails, view.bodies, home, away, ballHeat, heatColor, !reduced);
      }

      // 6. Turn guides (scene layer) & queue guide badges for post-refraction overlay
      const activeGuide = playback ? playback.guide : getGuide();
      const overlayGuideMoves = Boolean(guideShown('moves', activeGuide) && activeGuide);
      if (guideShown('trails', activeGuide) && activeGuide) {
        activeGuide.paths.forEach((path, i) => {
          if (!path || path.length < 2) return;
          const col = i < 3 ? home : i < 6 ? away : text;
          const pts = [];
          for (let k = 0; k < path.length; k += 2) pts.push({ x: path[k], y: path[k + 1] });
          if (pts.length >= 2) gpu.strokePolyline(pts, col, i < 6 ? 3 : 2, 0.6);
          gpu.fillCircle(path[0], path[1], i < 6 ? 4 : 3, col, 0.9);
        });
      }
      const drawImpulseWebGL = (body, plan, col) => {
        if (!plan) return;
        const arrow = impulseGeometry(P, body, plan);
        if (!arrow.visible) return;
        const startX = body.x + Math.cos(plan.angle) * arrow.ringR;
        const startY = body.y + Math.sin(plan.angle) * arrow.ringR;
        const endX = arrow.x, endY = arrow.y;
        const a = plan.guard ? 0.25 : 1;
        gpu.strokeLine(startX, startY, endX, endY, col, 4, a, true);
        for (const offset of [-0.55, 0.55]) {
          gpu.strokeLine(endX, endY, endX - Math.cos(plan.angle + offset) * 14, endY - Math.sin(plan.angle + offset) * 14, col, 4, a, true);
        }
      };
      if (overlayGuideMoves) {
        activeGuide.start.slice(0, 6).forEach((b, i) => {
          const plan = activeGuide.moves[i], col = i < 3 ? home : away;
          gpu.strokeCircle(b.x, b.y, b.radius, col, 2, 0.7, 4, 6);
          drawImpulseWebGL(b, plan, col);
        });
      }

      // Helper for shockwaves (shared by Pass 1 non-overlay and Pass 3 overlay)
      const drawShockwaveItem = s => {
        const progress = 1 - Math.max(0, s.life / s.duration);
        const isSpecial = s.dramatic || s.hipClip || s.check || s.spinStrike || s.spinTwirl || s.koCone || s.colossusGrowth;
        const expand = isSpecial ? 1 - (1 - progress) ** 2.6 : progress;
        const fade = isSpecial ? (1 - progress) ** 1.25 : 1 - progress;
        const r = s.currentRadius + (s.maxRadius - s.currentRadius) * expand;
        const waveColor = s.color || (s.team === 0 ? home : away);
        const baseW = s.width || (s.overlay ? 4.5 : 6);
        if (s.colossusGrowth) {
          const cx = s.target?.x ?? s.x, cy = s.target?.y ?? s.y;
          const a = Math.max(0, fade * 0.90);
          gpu.strokeCircle(cx, cy, r, waveColor, Math.max(1.2, baseW * fade), a, 12, 8);
          if (fade > 0.18) {
            gpu.strokeCircle(cx, cy, Math.max(2, r - 4), '#fff5b8', Math.max(1, baseW * 0.45 * fade), a * 0.72);
          }
          const rayCount = 12;
          const rot = s.startAngle || 0;
          const rayLen = 18 + 14 * expand;
          for (let k = 0; k < rayCount; k++) {
            const ang = rot + (k / rayCount) * Math.PI * 2;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const r0 = Math.max(2, r * 0.90), r1 = r + rayLen;
            gpu.strokeLine(cx + ca * r0, cy + sa * r0, cx + ca * r1, cy + sa * r1, k % 2 === 0 ? '#ffffff' : waveColor, Math.max(1.2, 2.8 * fade), a * 0.92, true);
          }
          return;
        }
        if (s.spinTwirl) {
          const tx = s.target?.x ?? s.x, ty = s.target?.y ?? s.y;
          const dir = s.spinDir || 1;
          const twirlR = s.currentRadius + (s.maxRadius - s.currentRadius) * Math.sin(Math.min(1, progress * 1.15) * Math.PI * 0.65);
          const rot = (s.startAngle || 0) + dir * (progress ** 0.72) * Math.PI * 3.8;
          const bladeW = Math.max(1.4, baseW * (0.5 + 0.5 * fade));
          const peakAlpha = Math.max(0, fade * 0.94);
          gpu.strokeCircle(tx, ty, twirlR * 0.96, waveColor, Math.max(1, bladeW * 0.45), peakAlpha * 0.35);
          for (let bIdx = 0; bIdx < 3; bIdx++) {
            const a0 = rot + (bIdx * Math.PI * 2) / 3;
            gpu.drawTaperedSpinArc(tx, ty, twirlR, a0, 1.38 * dir, bladeW, waveColor, peakAlpha);
          }
          for (let bIdx = 0; bIdx < 2; bIdx++) {
            const a0 = rot + 0.45 * dir + bIdx * Math.PI;
            gpu.drawTaperedSpinArc(tx, ty, twirlR * 0.68, a0, 1.55 * dir, bladeW * 0.62, '#ffffff', peakAlpha * 0.88);
          }
          return;
        }
        if (s.koCone) {
          const dir = s.normalAngle || 0;
          const halfArc = 0.56 + 0.24 * expand;
          gpu.strokeArc(s.x, s.y, r, dir - halfArc, dir + halfArc, waveColor, Math.max(1.5, baseW * fade), Math.max(0, fade * 0.92), true);
          if (fade > 0.2) {
            gpu.strokeArc(s.x, s.y, Math.max(2, r - 2), dir - halfArc * 0.65, dir + halfArc * 0.65, '#ffffff', Math.max(1, baseW * 0.42 * fade), Math.max(0, fade * 0.85), true);
          }
          return;
        }
        if (s.spinStrike) {
          const blades = s.blades || 3, dir = s.spinDir || 1;
          const rot = (s.startAngle || 0) + dir * (1 - (1 - progress) ** 1.75) * 2.55;
          const arcSweep = (blades === 3 ? 1.42 : 1.72) * (0.78 + 0.22 * fade) * dir;
          const bladeW = Math.max(1.4, baseW * (0.45 + 0.55 * fade));
          const peakAlpha = Math.max(0, fade * 0.94);
          for (let bIdx = 0; bIdx < blades; bIdx++) {
            const a0 = rot + (bIdx * Math.PI * 2) / blades;
            gpu.drawTaperedSpinArc(s.x, s.y, r, a0, arcSweep, bladeW, waveColor, peakAlpha);
            if (fade > 0.2) {
              gpu.drawTaperedSpinArc(s.x, s.y, Math.max(2, r - 1.2), a0 + arcSweep * 0.28, arcSweep * 0.68, bladeW * 0.48, '#ffffff', peakAlpha * 0.82);
            }
          }
          return;
        }
        if (s.hipClip || s.check) {
          const secondColor = (s.teamB ?? (1 - s.team)) === 0 ? home : away;
          const str = s.strength ?? 1;
          const sweep = s.hipClip ? (s.tangent || 0) + expand * (0.45 + 0.50 * str) : (s.normalAngle || 0);
          const halfArc = s.hipClip ? (0.32 + 0.50 * str) : (0.28 + 0.48 * str);
          for (let side = 0; side < 2; side++) {
            const a0 = sweep + side * Math.PI - halfArc, a1 = sweep + side * Math.PI + halfArc;
            gpu.strokeArc(s.x, s.y, r, a0, a1, side === 0 ? waveColor : secondColor, Math.max(1.2, baseW * fade), Math.max(0, fade * (0.55 + 0.37 * str)), true);
            if (fade > 0.2 && str > 0.25) {
              gpu.strokeArc(s.x, s.y, Math.max(1, r - 1.5), a0 + halfArc * 0.22, a1 - halfArc * 0.14, '#ffffff', Math.max(1, baseW * 0.4 * fade), Math.max(0, fade * 0.8 * str), true);
            }
          }
          return;
        }
        if (s.band) {
          gpu.strokeCircle(s.x, s.y, r, waveColor, Math.max(2, baseW * 2.4 * fade), Math.max(0, fade * 0.28));
        }
        gpu.strokeCircle(s.x, s.y, r, waveColor, Math.max(1, baseW * fade), Math.max(0, fade * (s.overlay ? 0.92 : 1)));
        if (s.band && fade > 0.15) {
          gpu.strokeCircle(s.x, s.y, Math.max(1, r - baseW * 0.25 * fade), '#ffffff', Math.max(1, baseW * 0.38 * fade), Math.max(0, fade * 0.85));
        }
      };

      // 7. Scene-layer shockwaves
      for (const s of fx.shockwaves) {
        if (!s.overlay) drawShockwaveItem(s);
      }

      // 8. Skaters (auras, reach rings, rasterized SVG character textures, warps,cones, magnet beams, arrows)
      const scoringPlayer = getScoringPlayer();
      const goalReplay = getGoalReplay();
      const onlineReplay = getOnlineReplay();
      const fwActive = fx.fireWarp && fx.fireWarp.life > 0 && !reduced ? fx.fireWarp : null;
      const koActive = fx.koWarp && fx.koWarp.life > 0 && !reduced ? fx.koWarp : null;
      const inAction = phase === 'play' || phase === 'replay' || Boolean(goalReplay);

      const drawSuperAuraWebGL = (b, key, reach) => {
        const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
        const level = b.superActive || b.superArm ? 2 : 1;
        const t = reduced ? 0 : clockNow() / 1000, spin = t * (0.6 + level * 1.2);
        const ringR = reach + 6 + level * 2;
        const haloR = ringR + 10 + level * 4 + (reduced ? 0 : Math.sin(t * 3) * 2);
        if (doc?.createElement) {
          const glowTex = superGlowSprite(key, doc);
          gpu.drawTexture(`superGlow:${key}`, glowTex, b.x - haloR, b.y - haloR, haloR * 2, haloR * 2, level === 2 ? 0.45 : 0.22);
        }
        if (key === 'shockwave' && b.superActive === 'shockwave' && b.shockwaveFired) {
          const ringCount = 4, rate = 1.35, startR = reach + 3, maxR = reach + 86, peakAlpha = 0.88;
          for (let w = 0; w < ringCount; w++) {
            const p = reduced ? (w + 0.3) / ringCount : (t * rate + w / ringCount) % 1;
            const ease = 1 - (1 - p) ** 1.65;
            const r = startR + (maxR - startR) * ease;
            const alpha = peakAlpha * Math.min(1, p / 0.14) * ((1 - p) ** 1.45);
            if (alpha <= 0.01) continue;
            const lw = 4.2 * (1 - p * 0.62);
            gpu.strokeCircle(b.x, b.y, r, c2, lw * 2.1, alpha * 0.42);
            gpu.strokeCircle(b.x, b.y, r, w % 2 === 0 ? c1 : '#ffb3c9', lw, alpha);
          }
          gpu.strokeCircle(b.x, b.y, ringR, c1, 2.2, 0.7);
          return;
        }
        if (gpu.drawSuperAuraShader) {
          gpu.drawSuperAuraShader(b.x, b.y, ringR, level === 2 ? 3.8 : 2.8, c1, c2, level, level === 2 ? 0.96 : 0.72);
        } else {
          gpu.strokeCircle(b.x, b.y, ringR, c1, level === 2 ? 2.5 : 2, level === 2 ? 0.75 : 0.55);
          if (doc?.createElement) {
            const ringAlpha = level === 2 ? 1 : 0.85;
            for (const [rad, dir] of level === 2 ? [[ringR, 1], [ringR + 5, -1]] : [[ringR, 1]]) {
              const lw = level === 2 ? 3.5 : 3;
              const sprite = conicRingSprite(key, rad, lw, doc), sz = sprite.size;
              gpu.pushTransform();
              gpu.translate(b.x, b.y);
              gpu.rotate(spin * dir);
              gpu.drawTexture(`conic:${key}:${Math.round(rad)}:${lw}`, sprite, -sz / 2, -sz / 2, sz, sz, ringAlpha);
              gpu.popTransform();
            }
          }
        }
        if (level === 2 && !reduced) {
          for (let k = 0; k < 2; k++) {
            const head = spin * 1.5 + k * Math.PI;
            for (let s = 4; s >= 0; s--) {
              const angle = head - s * 0.08;
              gpu.fillCircle(b.x + Math.cos(angle) * ringR, b.y + Math.sin(angle) * ringR, 2.2 - s * 0.3, s ? (k ? c2 : c1) : '#ffffff', (1 - s / 5) * 0.8);
            }
          }
        }
      };

      const drawTailgateConeWebGL = (b, draft) => {
        if (draft <= 0.22 || reduced) return;
        const speed = Math.hypot(b.vx || 0, b.vy || 0);
        if (speed < (P.TAILGATE?.minSpeed ?? 110)) return;
        const heading = Math.atan2(b.vy, b.vx);
        const reachR = Math.max(b.radius, b.reach || b.radius, 18);
        const strength = Math.min(1, (draft - 0.22) / 0.72);
        const t = clockNow() / 1000, phaseShift = (b.playerIndex || 0) * 1.9;
        const flutter = Math.sin(t * 20 + phaseShift) * 1.2;
        const r = reachR + 4.5;
        const noseX = r + 13 + 7 * strength + flutter * 0.6;
        const backX = -r * 0.88;
        const wingY = r + 16 + 7 * strength + flutter * 0.9;

        gpu.pushTransform();
        gpu.translate(b.x, b.y);
        gpu.rotate(heading);

        const coneSteps = 10;
        const shroudL = [[noseX, 0]], shroudR = [[noseX, 0]];
        for (let s = 1; s <= coneSteps; s++) {
          const u = s / coneSteps;
          const x = noseX + (backX - noseX) * Math.pow(u, 0.94);
          const y = wingY * Math.pow(u, 0.72);
          // Carve inner ring boundary along front arc
          const ix = Math.min(x, Math.cos((u * 2.32)) * (r + 1.2));
          const iy = Math.sin(Math.min(Math.PI * 0.74, u * 2.32)) * (r + 1.2);
          shroudL.push([x, y]);
          shroudR.push([ix, iy]);
        }
        const shroudStops = [
          [0, `rgba(210, 248, 255, ${(0.28 + 0.22 * strength).toFixed(3)})`],
          [0.45, `rgba(170, 236, 255, ${(0.14 + 0.14 * strength).toFixed(3)})`],
          [1, 'rgba(170, 236, 255, 0)']
        ];
        gpu.fillRibbonPairsWithLinearGrad(shroudL, shroudR, noseX, 0, backX, 0, shroudStops, 1);
        gpu.fillRibbonPairsWithLinearGrad(
          shroudL.map(([x, y]) => [x, -y]),
          shroudR.map(([x, y]) => [x, -y]),
          noseX, 0, backX, 0, shroudStops, 1
        );

        const bladeStops = [
          [0, `rgba(248, 254, 255, ${(0.65 + 0.3 * strength).toFixed(3)})`],
          [0.5, `rgba(182, 240, 255, ${(0.36 + 0.24 * strength).toFixed(3)})`],
          [1, 'rgba(182, 240, 255, 0)']
        ];
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
          gpu.fillRibbonPairsWithLinearGrad(outerPts, innerPts, noseX, 0, backX, 0, bladeStops, 1);

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
          gpu.fillRibbonPairsWithLinearGrad(iOut, iIn, noseX, 0, backX, 0, bladeStops, 1);
        }
        gpu.popTransform();
      };

      const badgeOverlayQueue = [];

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
          gpu.pushTransform();
          gpu.translate(b.x, b.y);
          gpu.rotate(ubuWarpAngle);
          gpu.scale(ubuScaleX, ubuScaleY);
          gpu.rotate(-ubuWarpAngle);
          gpu.translate(-b.x, -b.y);
        }

        if (isSuperReady) {
          const activeKey = b.superActive || b.equippedSuper?.key || 'stalwart';
          drawSuperAuraWebGL(b, activeKey, reachR);
          if (phase === 'plan' && b.superArm && activeKey === 'colossus') {
            gpu.strokeCircle(b.x, b.y, Math.max(b.baseRadius ?? b.radius, P.SUPER?.colossusRadius || 56.25), '#ffe043cc', 2, 1, 5, 5);
          }
          badgeOverlayQueue.push({ kind: 'super', b, key: activeKey });
        }

        const teamCol = i < 3 ? home : away;
        const coil = aimCoilPose(b, fieldPlans?.[i], phase, reduced);
        if (!b.carded) {
          gpu.strokeCircle(b.x, b.y, reachR + 2, teamCol, 4, 1);
          if (coil) {
            const backAng = coil.angle + Math.PI;
            const halfSpan = 0.34 + 0.44 * coil.power;
            gpu.strokeArc(b.x, b.y, Math.max(8, b.radius - 1.2), backAng - halfSpan, backAng + halfSpan, '#ffffff', 2.2, 0.18 + 0.36 * coil.power, true);
          }
        }

        if ((phase === 'goal' || (onlineReplay?.goalPlayed && phase === 'play')) && b === scoringPlayer) {
          const goalAccent = b.team === 0 ? home : away;
          gpu.strokeCircle(b.x, b.y, b.radius + 9, goalAccent, 4, 1);
          gpu.strokeCircle(b.x, b.y, b.radius + 15, goalAccent, 2, 1);
        }

        // Render rasterized character sprite inside the GPU scene (coiled back inside fixed ring when aimed in plan)
        if (!bench?.flags.noDomSkaters) {
          const art = resolveSkaterArt(i);
          const opacity = b.carded ? 0.3 : b.superActive === 'ghost' ? 0.45 : 1;
          const stunAmt = (b.stunned || b.stunnedNext) && !b.carded ? 1 : 0;
          const rot = b.rotation + (view.portrait ? Math.PI / 2 : 0);
          const sz = b.radius * 2;
          const cx = b.x + (coil ? coil.dx : 0), cy = b.y + (coil ? coil.dy : 0);
          gpu.pushTransform();
          gpu.translate(cx, cy);
          if (coil && (coil.scaleX !== 1 || coil.scaleY !== 1)) {
            gpu.rotate(coil.angle);
            gpu.scale(coil.scaleX, coil.scaleY);
            gpu.rotate(-coil.angle);
          }
          if (art) {
            gpu.rotate(rot);
            gpu.drawTexture(null, art, -sz / 2, -sz / 2, sz, sz, opacity, stunAmt);
          } else {
            gpu.fillCircle(0, 0, b.radius, view.entries?.[i]?.model?.attributes?.background?.hex || teamCol, opacity);
          }
          gpu.popTransform();
        }

        if (ubuWarped) gpu.popTransform();

        if (inAction && !b.carded && !reduced) {
          const draft = P.tailgateFactor ? P.tailgateFactor(view.bodies, b) : 0;
          if (draft > 0.22) drawTailgateConeWebGL(b, draft);
        }

        if ((inAction && b.guarding) || (phase === 'plan' && fieldPlans?.[i]?.guard)) {
          const iron = phase === 'plan'
            ? Boolean(predictionCache?.data.guards.some(g => g.index === i && g.held))
            : Boolean(b.ironGuard);
          badgeOverlayQueue.push({ kind: 'guard', b, index: i, iron });
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
            const animSec = reduced ? 0 : (fx.heatTime || 0);
            gpu.strokeLine(b.x, b.y, ball.x, ball.y, '#3388ffcc', 2.2 + closeness * 1.1, 1, false, 4, 6);
            for (let side = -1; side <= 1; side += 2) {
              const bow = side * (8 + 10 * closeness) * Math.sin(animSec * 6 + side);
              const mx = (ball.x + b.x) * 0.5 + px * bow;
              const my = (ball.y + b.y) * 0.5 + py * bow;
              const qPts = [];
              for (let s = 0; s <= 12; s++) {
                const u = s / 12, inv = 1 - u;
                qPts.push({
                  x: inv * inv * ball.x + 2 * inv * u * mx + u * u * b.x,
                  y: inv * inv * ball.y + 2 * inv * u * my + u * u * b.y
                });
              }
              gpu.strokePolyline(qPts, side < 0 ? '#3388ff66' : '#ff334466', 1.5, 1);
            }
            const chevCount = 4, pullAng = Math.atan2(dy, dx);
            for (let c = 0; c < chevCount; c++) {
              const u = ((c / chevCount) + animSec * (1.8 + 1.4 * closeness)) % 1;
              if (u < 0.12 || u > 0.88) continue;
              const cx = ball.x + dx * u, cy = ball.y + dy * u;
              const fade = Math.sin(u * Math.PI), span = 5.5 + 3.5 * (1 - u);
              const col = c % 2 === 0 ? '#7ec8ff' : '#ff6b7a';
              const a = fade * (0.5 + 0.45 * closeness);
              gpu.pushTransform();
              gpu.translate(cx, cy);
              gpu.rotate(pullAng);
              gpu.strokeLine(-span * 0.75, -span, span * 0.45, 0, col, 2.1, a, true);
              gpu.strokeLine(span * 0.45, 0, -span * 0.75, span, col, 2.1, a, true);
              gpu.popTransform();
            }
          }
        }
        if (i < 3 && phase === 'plan') drawImpulseWebGL(b, fieldPlans[i], home);
      });

      // Second pass over skater head-top indicators (daze swirl & stun stars) so adjacent skaters never cover them
      view.bodies.slice(0, 6).forEach(b => {
        const slow = P.dazeSlow(b);
        if (slow > 0 && !b.stunned) {
          const depth = slow / P.DAZE.max, spin = reduced ? 0 : clockNow() / 300;
          const cx = view.portrait ? b.x + b.radius + 12 : b.x;
          const cy = view.portrait ? b.y : b.y - b.radius - 12;
          const pts = [];
          for (let a = 0; a <= Math.PI * 3.5; a += 0.22) {
            const r = 1 + a * (0.7 + 0.4 * depth);
            pts.push({ x: cx + Math.cos(a + spin) * r, y: cy + Math.sin(a + spin) * r });
          }
          gpu.strokePolyline(pts, '#c3cbff', 2, 0.55 + 0.45 * depth);
        }
        if ((b.stunned || b.stunnedNext) && !b.carded) {
          const st = getStampCanvas('stunStars', 24, 24, pxScale, g => {
            g.translate(12, 12);
            g.scale(18 / 24, 18 / 24);
            g.translate(-12, -12);
            g.fillStyle = '#ffe043'; g.strokeStyle = '#101112'; g.lineWidth = 2; g.lineJoin = 'round';
            g.stroke(STUN_STARS); g.fill(STUN_STARS);
          });
          if (st) {
            gpu.pushTransform();
            if (view.portrait) {
              gpu.translate(b.x + b.radius + 14, b.y);
              gpu.rotate(Math.PI / 2);
            } else {
              gpu.translate(b.x, b.y - b.radius - 10);
            }
            gpu.drawTexture(st.key, st.canvas, -12, -12, 24, 24, 1);
            gpu.popTransform();
          }
        }
      });

      // 9. Sticky tether & selected skater ring
      const holding = P.holder?.(view.bodies);
      if (holding && view.bodies[6]) {
        const ball = view.bodies[6];
        const dx = ball.x - holding.x, dy = ball.y - holding.y, d = Math.hypot(dx, dy);
        if (d > Math.abs(holding.radius - ball.radius) && d > 0) {
          const ux = dx / d, uy = dy / d;
          const c = (holding.radius - ball.radius) / d, t = Math.sqrt(Math.max(0, 1 - c * c));
          const ends = [-1, 1].map(sign => {
            const nx = ux * c - sign * uy * t, ny = uy * c + sign * ux * t;
            return { ax: holding.x + nx * holding.radius, ay: holding.y + ny * holding.radius, bx: ball.x + nx * ball.radius, by: ball.y + ny * ball.radius };
          });
          const pulse = reduced ? 0.65 : 0.65 + 0.15 * Math.sin(getElapsed() * 14);
          gpu.fillQuad(ends[0].ax, ends[0].ay, ends[0].bx, ends[0].by, ends[1].bx, ends[1].by, ends[1].ax, ends[1].ay, '#44dd662b', pulse);
          for (const e of ends) {
            if (!reduced && !noBlur) gpu.strokeLine(e.ax, e.ay, e.bx, e.by, '#44dd66', 9, pulse * 0.32, true);
            gpu.strokeLine(e.ax, e.ay, e.bx, e.by, '#44dd66', 3, pulse, true);
            gpu.strokeLine(e.ax, e.ay, e.bx, e.by, '#d9ffe3', 1, pulse, true);
          }
        }
      }

      if (phase === 'plan') {
        const sel = view.bodies[getSelected()];
        if (sel) gpu.strokeCircle(sel.x, sel.y, sel.radius + 8, text, 2, 1);
      }

      // 10. Ball & Spin Swirls
      const drawSpinWebGL = (b, col) => {
        const spin = Math.abs(b.omega);
        if (spin < 2.5 || reduced || bench?.flags.noSpin) return;
        const power = Math.min(1, (spin - 2.5) / 20), arcs = spin >= 8 ? 3 : 2;
        const dir = Math.sign(b.omega);
        const sweep = (arcs === 3 ? (1.28 + 0.56 * power) : (1.42 + 0.95 * power)) * dir;
        for (let k = 0; k < arcs; k++) {
          const start = b.rotation + k * 2 * Math.PI / arcs;
          gpu.drawTaperedSpinArc(b.x, b.y, b.radius + 4.5, start, sweep, 1.65 + 2.15 * power, col, Math.min(0.96, 0.36 + 0.58 * power));
          if (power > 0.30) {
            gpu.drawTaperedSpinArc(b.x, b.y, b.radius + 9.8, start + sweep * 0.14, sweep * 0.84, 1.15 + 1.15 * power, col, Math.min(0.76, 0.22 + (power - 0.30) * 0.76));
          }
        }
      };

      const ball = view.bodies[6];
      if (ball) {
        const fw = fx.fireWarp && fx.fireWarp.life > 0 && !reduced ? fx.fireWarp : null;
        const tw = !fw && fx.ballTapWarp && fx.ballTapWarp.life > 0 && !reduced ? fx.ballTapWarp : null;
        let warpScaleX = 1, warpScaleY = 1, warpAngle = 0;
        if (tw) {
          const tp = 1 - Math.max(0, tw.life / tw.duration);
          const env = Math.sin(Math.min(1, tp / 0.35) * Math.PI * 0.5) * ((1 - tp) ** 1.3);
          const amt = env * 0.11 * (tw.strength || 0.6);
          warpScaleX = 1 - amt;
          warpScaleY = 1 + amt * 0.78;
          warpAngle = Math.atan2(tw.ny || 0, tw.nx || 1);
        }
        if (fw) {
          const wp = 1 - Math.max(0, fw.life / fw.duration);
          const env = (1 - wp) * Math.cos(wp * Math.PI * 2.2);
          const amt = env * 0.13;
          warpScaleX = 1 - amt;
          warpScaleY = 1 + amt;
          warpAngle = Math.atan2(fw.ny || 0, fw.nx || 1);
          const glowFade = (1 - wp) ** 1.3;
          const burstR = ball.radius * (1.15 + wp * 1.35);
          gpu.pushTransform();
          gpu.translate(fw.x, fw.y);
          gpu.rotate(warpAngle);
          gpu.scale(1 - (1 - wp) * 0.18, 1 + (1 - wp) * 0.18);
          gpu.fillCircle(0, 0, burstR, '#ff8c24', 0.28 * glowFade);
          gpu.strokeCircle(0, 0, burstR, '#fff0a8', Math.max(1, 3.2 * glowFade), 0.72 * glowFade);
          gpu.popTransform();
        }
        gpu.pushTransform();
        if (fw || tw) {
          gpu.translate(ball.x, ball.y);
          gpu.rotate(warpAngle);
          gpu.scale(warpScaleX, warpScaleY);
          gpu.rotate(-warpAngle);
          gpu.translate(-ball.x, -ball.y);
        }
        gpu.fillCircle(ball.x, ball.y, ball.radius, background, 1);
        gpu.strokeCircle(ball.x, ball.y, ball.radius, text, 2, 1);
        const heat = ballHeat(ball), flare = fx.ballFlare || 0, glow = Math.min(1.35, Math.max(0, heat - 1) / 2 + flare * 0.45);
        if (glow > 0) {
          const hc = heatColor(Math.max(heat, flare > 0.1 ? 3 : heat));
          const ga = Math.min(1, 0.75 * glow);
          if (!noBlur && doc?.createElement) {
            const gs = glowSprite(hc, doc);
            const haloSz = (ball.radius * 2 + (16 + flare * 12) * glow) * 2.2;
            gpu.drawTexture(`glow:${hc}`, gs, ball.x - haloSz / 2, ball.y - haloSz / 2, haloSz, haloSz, ga * 0.85);
          }
          gpu.fillCircle(ball.x, ball.y, ball.radius, hc, ga);
        }
        const hot = ballOnFire() || (ball.team === -1 && P.ballOnFire?.(ball));
        drawBallGlyph(ball.x, ball.y, ball.radius, ball.rotation + (view.portrait ? Math.PI / 2 : 0), hot, ball.strikerTeam);
        gpu.popTransform();

        view.bodies.slice(0, 6).forEach(b => { if (!b.carded) drawSpinWebGL(b, b.team ? away : home); });
        drawSpinWebGL(ball, text);
      }

      // 11. Particles helper (overlay = false in Pass 1 so flames & sparks refract; overlay = true in Pass 3)
      const drawParticlesWebGL = overlay => {
        if (bench?.flags.noParticles) return;
        if (overlay) {
          for (const f of fx.fireworks) {
            if ((f.delay || 0) > 0) continue;
            const cometColor = f.team === 0 ? home : away;
            if (doc?.createElement) {
              const gs = glowSprite(cometColor, doc);
              gpu.drawTexture(`glow:${cometColor}`, gs, f.x - 18, f.y - 18, 36, 36, 0.92);
            }
            gpu.strokeLine(f.x - (f.vx || 0) * 0.035, f.y - f.vy * 0.035, f.x, f.y, '#ffe9b0', 2.8, 0.92, true);
            gpu.fillCircle(f.x, f.y, 2.1, '#ffffff', 0.92);
          }
        }
        const flameDots = [];
        for (const p of fx.particles) {
          if (Boolean(p.overlay) !== overlay) continue;
          const col = p.color || (p.team === -1 ? '#ffffff' : p.team === 0 ? home : away);
          const fade = Math.max(0, p.life / p.duration);
          const shimmer = p.celebration && fade < 0.38 ? 0.55 + 0.45 * Math.sin((p.twinkle || 0) + fade * 38) : 1;
          const baseAlpha = Math.min(1, fade * 2) * (p.celebration || p.snap ? 0.95 : 0.65) * shimmer * (p.alphaScale ?? 1);
          if (p.flash) {
            if (doc?.createElement) {
              const sz = (p.flashSize || 170) * fade;
              const gs = glowSprite(col, doc);
              gpu.drawTexture(`glow:${col}`, gs, p.x - sz / 2, p.y - sz / 2, sz, sz, fade * 0.85);
            }
            continue;
          }
          if (p.growthLine) {
            const ang = p.angle || 0;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const halfLen = (p.len || 14) * (0.45 + 0.55 * fade) * 0.5;
            const lw = Math.max(1, (p.width || 2.4) * (0.45 + 0.55 * fade));
            const x0 = p.x - ca * halfLen, y0 = p.y - sa * halfLen;
            const x1 = p.x + ca * halfLen, y1 = p.y + sa * halfLen;
            const a = Math.min(1, fade * 2.2) * 0.92;
            gpu.strokeLine(x0, y0, x1, y1, col, lw, a, true);
            gpu.strokeLine(x0 + ca * halfLen * 0.25, y0 + sa * halfLen * 0.25, x1, y1, '#ffffff', Math.max(0.9, lw * 0.44), a, true);
            continue;
          }
          if (p.materialShape) {
            const sz = p.size * Math.min(1, fade * 2);
            const lw = p.snap ? 2.4 : 1;
            gpu.pushTransform();
            gpu.translate(p.x, p.y);
            if (p.angle) gpu.rotate(p.angle);
            if (p.materialShape === 'spark') {
              gpu.strokeLine(-sz, 0, sz, 0, col, lw, baseAlpha, true);
              gpu.strokeLine(0, -sz, 0, sz, col, lw, baseAlpha, true);
            } else if (p.materialShape === 'streak') {
              gpu.strokeLine(-sz * 2, 0, sz * 2, 0, col, lw, baseAlpha, true);
            } else if (p.materialShape === 'shard') {
              gpu.fillTriangle(0, -sz * 1.6, sz, sz, -sz, sz, col, baseAlpha);
            } else if (p.materialShape === 'chip') {
              gpu.fillRect(-sz / 2, -sz / 2, sz, sz, col, baseAlpha);
            } else if (p.materialShape === 'bubble') {
              gpu.strokeCircle(0, 0, sz, col, lw, baseAlpha);
            } else {
              gpu.fillCircle(0, 0, sz, col, baseAlpha);
            }
            gpu.popTransform();
            continue;
          }
          if (p.flame) {
            flameDots.push({ x: p.x, y: p.y, r: p.flame * 0.45 * (0.4 + 0.6 * fade), color: col, alpha: baseAlpha });
            continue;
          }
          if (p.celebration) {
            const starSize = p.size || 2;
            const halo = (34 + 18 * fade) * (starSize / 2);
            if (doc?.createElement) {
              const gs = glowSprite(col, doc);
              gpu.drawTexture(`glow:${col}`, gs, p.x - halo / 2, p.y - halo / 2, halo, halo, baseAlpha);
            }
            const tailDt = 0.058 * (0.35 + 0.65 * fade);
            const tx = p.x - p.vx * tailDt, ty = p.y - p.vy * tailDt;
            gpu.strokeLine(tx, ty, p.x, p.y, col, starSize * 1.45, baseAlpha * 0.42, true);
            gpu.strokeLine((tx + p.x) * 0.5, (ty + p.y) * 0.5, p.x, p.y, col, starSize, baseAlpha, true);
            gpu.fillCircle(p.x, p.y, starSize * (0.65 + 0.35 * fade), col, baseAlpha);
            gpu.fillCircle(p.x, p.y, Math.max(0.75, starSize * 0.48 * fade), '#ffffff', baseAlpha);
            continue;
          }
          const px = p.px === p.x && p.py === p.y ? p.x - 0.01 : p.px;
          gpu.strokeLine(px, p.py, p.x, p.y, col, p.snap ? 2.6 : 1.3, baseAlpha, true);
          gpu.fillCircle(p.x, p.y, p.snap ? 1.9 : 0.9, col, baseAlpha);
        }
        if (flameDots.length) {
          gpu.setBlend('add');
          for (const f of flameDots) gpu.fillCircle(f.x, f.y, f.r, f.color, f.alpha);
          gpu.setBlend('normal');
        }
      };

      drawParticlesWebGL(false);

      // 12. Pass 2: True GPU Scene-to-Texture Heat Refraction & Chromatic Dispersion
      if (heatSources.length > 0) {
        gpu.applyHeatRefraction(heatSources, !reduced);
      }

      // 12b. Pass 2.5: Half-Res Emissive Multi-Pass Bloom (#5) at 0.5x additive gain
      if (!reduced && !noBlur && gpu.beginEmissive?.()) {
        if (!view.castHidden) {
          const bloomBall = view.bodies[6];
          if (bloomBall && (ballOnFire() || (bloomBall.team === -1 && P.ballOnFire?.(bloomBall)))) {
            const heat = ballHeat(bloomBall);
            const flare = fx.ballFlare || 0;
            const warpFlare = Math.max(0, fx.ballWarpFlare || 0);
            const hc = heatColor(Math.max(heat, flare > 0.1 ? 3 : heat));
            gpu.fillCircle(bloomBall.x, bloomBall.y, bloomBall.radius * (1.28 + warpFlare * 0.42), hc, 0.72);
          }
          if (!bench?.flags.noAuras) {
            for (const b of view.bodies.slice(0, 6)) {
              if (b.carded) continue;
              const key = b.equippedSuper?.key;
              if (!key || !(b.superActive || b.superArm || (b.meter ?? 0) >= 100)) continue;
              const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
              const level = b.superActive || b.superArm ? 2 : 1;
              const reachR = Math.max(b.radius, b.reach || b.radius, 18);
              const ringR = reachR + 6 + level * 2;
              if (gpu.drawSuperAuraShader) {
                gpu.drawSuperAuraShader(b.x, b.y, ringR, level === 2 ? 5.2 : 4.2, c1, c2, level, level === 2 ? 0.44 : 0.24);
              } else {
                gpu.strokeCircle(b.x, b.y, ringR, c1, level === 2 ? 5 : 4, level === 2 ? 0.42 : 0.22);
              }
            }
          }
        }
        for (const s of fx.shockwaves) {
          drawShockwaveItem(s);
        }
        if (!bench?.flags.noParticles) {
          for (const f of fx.fireworks) {
            if ((f.delay || 0) > 0) continue;
            gpu.fillCircle(f.x, f.y, 4.2, f.team === 0 ? home : away, 0.82);
          }
          for (const p of fx.particles) {
            if (p.growthLine) {
              const fade = Math.max(0, p.life / p.duration);
              const ang = p.angle || 0, ca = Math.cos(ang), sa = Math.sin(ang);
              const halfLen = (p.len || 14) * (0.45 + 0.55 * fade) * 0.5;
              const lw = Math.max(1.4, (p.width || 2.4) * 1.35 * (0.45 + 0.55 * fade));
              gpu.strokeLine(p.x - ca * halfLen, p.y - sa * halfLen, p.x + ca * halfLen, p.y + sa * halfLen, p.color || '#ffe043', lw, Math.min(1, fade * 2) * 0.58, true);
              continue;
            }
            if (!p.flame && !p.celebration && !p.emberSpark) continue;
            const col = p.color || (p.team === -1 ? '#ffffff' : p.team === 0 ? home : away);
            const fade = Math.max(0, p.life / p.duration);
            const r = p.flame ? p.flame * 0.55 * (0.4 + 0.6 * fade) : (p.emberSpark ? (p.size || 1.3) * (1.8 + 0.6 * fade) : (p.size || 2) * (1.6 + 0.8 * fade));
            gpu.fillCircle(p.x, p.y, r, col, Math.min(1, fade * 1.8) * (p.flame ? 0.72 : (p.emberSpark ? 0.45 * (p.alphaScale ?? 1) : 0.62)));
          }
        }
        if (predictedGoalBloom) {
          gpu.fillRoundRect(predictedGoalBloom.cx, 300, predictedGoalBloom.depth, 140, 0, predictedGoalBloom.col, predictedGoalBloom.alpha, predictedGoalBloom.netW);
        }
        if (fx.goalSweep) {
          const sweep = fx.goalSweep, sColor = sweep.team ? away : home;
          const p = sweep.p, sx = sweep.team ? 60 + p * 880 : 940 - p * 880;
          gpu.setClip(1);
          gpu.fillRect(sx - 28, 60, 56, 480, sColor, (1 - p * 0.5) * 0.38);
          gpu.setClip(0);
        }
        gpu.endEmissive(0.5);
      }

      // 13. Pass 3: Post-Refraction Field Overlays (ripples, pings, goalSweep, Pulse bar, badges, fouls, popups, fireworks)
      for (const r of fx.ripples) {
        const p = 1 - r.life / r.duration;
        const baseScale = r.goalPocket ? 13 : (r.net ? 9.5 : 8);
        const freq = r.goalPocket ? 4.2 : 5;
        const bulge = r.amp * baseScale * (1 - p) * Math.cos(p * Math.PI * freq);
        const pts = [];
        for (let k = r.lo; k <= r.hi; k++) {
          const w = r.run[k], d = bulge * Math.sin(Math.PI * (k - r.lo) / Math.max(1, r.hi - r.lo)) ** (r.goalPocket ? 1.4 : 2);
          pts.push({ x: w.x + w.nx * d, y: w.y + w.ny * d });
        }
        const netColor = r.side ? away : home;
        gpu.strokePolyline(pts, r.net ? netColor : border, r.goalPocket ? 5.2 : 4, (1 - p) * 0.9);
        if (r.goalPocket && p < 0.65) {
          gpu.strokePolyline(pts, '#ffffff', 2, (1 - p / 0.65) * 0.65);
        }
        if (r.meteor && r.x != null && r.y != null) {
          const glowFade = (1 - p) ** 1.35;
          if (glowFade > 0.01) {
            const glowR = 26 * (0.8 + 0.35 * (1 - glowFade));
            gpu.drawRadialStops(r.x, r.y, glowR, [
              [0.00, '#ffffff'],
              [0.25, '#fff3b0'],
              [0.55, '#ff7a1a'],
              [0.85, 'rgba(255, 84, 0, 0.45)'],
              [1.00, 'rgba(255, 84, 0, 0)']
            ], glowFade * 0.88, 20);
            gpu.fillCircle(r.x, r.y, 6.5 * glowFade, '#ffffff', glowFade * 0.95);
          }
        }
      }

      for (const g of fx.pings) {
        const p = 1 - g.life / g.duration;
        const fade = (1 - p) ** 1.15;
        const amp = g.amp ?? 0.7;
        const shiver = (1 - p) ** 1.6 * Math.sin(p * Math.PI * 18) * (2.6 * amp);
        const sx = g.x + (g.nx || 0) * shiver * 0.5 - (g.ny || 0) * shiver;
        const sy = g.y + (g.ny || 0) * shiver * 0.5 + (g.nx || 0) * shiver;
        gpu.strokeCircle(g.x, g.y, 4 + p * (18 + 6 * amp), text, 2.2, fade);
        if (amp > 0.45) {
          gpu.strokeCircle(g.x, g.y, 6 + p * (28 + 8 * amp), '#ffd76b', 1.6, fade * 0.72);
        }
        if (Math.abs(g.spin || 0) >= 6 && fade > 0.15) {
          const spinDir = Math.sign(g.spin) || 1;
          const spinPow = Math.min(1, Math.abs(g.spin) / 20);
          const rot = p * spinDir * 4.2;
          gpu.drawTaperedSpinArc(g.x, g.y, 8 + p * 18, rot, 1.45 * spinDir, 2.2 + 1.2 * spinPow, '#ffd76b', fade * 0.85);
          gpu.drawTaperedSpinArc(g.x, g.y, 8 + p * 18, rot + Math.PI, 1.45 * spinDir, 2.2 + 1.2 * spinPow, '#ffffff', fade * 0.75);
        }
        gpu.fillCircle(sx, sy, (3.6 + 1.4 * amp) * (1 - p * 0.65) + 1, p < 0.35 ? '#ffd76b' : text, fade);
      }

      if (fx.goalSweep) {
        const sweep = fx.goalSweep, sColor = sweep.team ? away : home;
        const p = sweep.p, sx = sweep.team ? 60 + p * 880 : 940 - p * 880;
        const dim = 0.14 * Math.sin(Math.PI * p);
        gpu.setClip(1);
        if (dim > 0.005) gpu.fillRect(60, 60, 880, 480, `rgba(8, 10, 14, ${dim.toFixed(3)})`, 1);
        const wash = 0.12 * Math.sin(Math.PI * p);
        if (wash > 0.001) gpu.fillRect(60, 60, 880, 480, sColor, wash);
        gpu.fillBandLinearX(60, 60, 880, 480, sx - 220, sx + 220, [
          [0.0, hexToRgba(sColor, 0)],
          [0.4, hexToRgba(sColor, 0.32)],
          [0.5, 'rgba(255,255,255,0.5)'],
          [0.6, hexToRgba(sColor, 0.32)],
          [1.0, hexToRgba(sColor, 0)]
        ], 1 - p * 0.6);
        const scorer = getScoringPlayer();
        if (scorer && scorer.x != null && scorer.y != null) {
          const spotR = (scorer.radius || 25) * 3.8;
          gpu.drawRadialStops(scorer.x, scorer.y, spotR, [
            [0.00, hexToRgba(sColor, 0.28 * (1 - p * 0.7))],
            [0.55, hexToRgba(sColor, 0.11 * (1 - p * 0.7))],
            [1.00, hexToRgba(sColor, 0)]
          ], 1, 24);
        }
        gpu.setClip(0);

        const mouth = sweep.team ? 60 : 940, back = sweep.team ? mouth - P.rink.goalDepth : mouth + P.rink.goalDepth;
        const sweepKey = `${sweep.team}\u0000${sColor}\u0000${width || 1000}`;
        let sweepSprite = fx.goalSweepCache?.key === sweepKey ? fx.goalSweepCache : null;
        if (!sweepSprite && doc?.createElement) {
          const sc = doc.createElement('canvas');
          const sctx = sc?.getContext?.('2d');
          if (sctx && typeof sctx.stroke === 'function') {
            const pad = 64, minX = Math.min(mouth, back) - pad, minY = 230 - pad;
            const lw = Math.abs(back - mouth) + pad * 2, lh = 140 + pad * 2;
            sc.width = Math.max(1, Math.ceil(lw * pxScale));
            sc.height = Math.max(1, Math.ceil(lh * pxScale));
            sctx.setTransform(pxScale, 0, 0, pxScale, -minX * pxScale, -minY * pxScale);
            sctx.lineCap = 'round';
            sctx.shadowColor = sColor; sctx.shadowBlur = 24 * pxScale;
            const seg = (x1, y1, x2, y2, stroke, w) => {
              sctx.beginPath(); sctx.moveTo(x1, y1); sctx.lineTo(x2, y2);
              sctx.strokeStyle = stroke; sctx.lineWidth = w; sctx.stroke();
            };
            seg(mouth, 230, back, 230, sColor, 6);
            seg(back, 230, back, 370, sColor, 6);
            seg(mouth, 370, back, 370, sColor, 6);
            seg(mouth, 230, mouth, 370, '#ffffff', 3);
            sweepSprite = fx.goalSweepCache = { key: sweepKey, canvas: sc, minX, minY, lw, lh };
          }
        }
        if (sweepSprite) {
          gpu.drawTexture('goalSweep:' + sweepSprite.key, sweepSprite.canvas, sweepSprite.minX, sweepSprite.minY, sweepSprite.lw, sweepSprite.lh, 1 - p);
        }
      }

      if (pulseMode() && !goalReplay && !isCardShot()) {
        const turnSeconds = ububallMatch.turnTicks(view.mode) * P.DT;
        const online = getOnline();
        const progress = playback ? playback.tick * P.DT / turnSeconds
          : phase !== 'play' ? 0
          : online?.active ? (onlineReplay?.currentTick ?? 0) * P.DT / turnSeconds
          : getElapsed() / turnSeconds;
        gpu.strokeLine(160, 556, 840, 556, border, 4, 0.25, true);
        if (progress > 0) gpu.strokeLine(160, 556, 160 + 680 * Math.min(1, progress), 556, '#DA4DB5', 4, 0.9, true);
      }

      // Redraw non-distorted planning circles & turn previews on top so true positions stay readable through heat refraction
      if (phase === 'plan' && !view.castHidden && heatSources.length > 0) {
        if (!bench?.flags.noPredictAll && !bench?.flags.noPredictLayer && predictionCache?.data) {
          drawPredictionOverlayWebGL(predictionCache.data);
        }
        view.bodies.slice(0, 6).forEach((b, i) => {
          const teamCol = i < 3 ? home : away;
          const reachR = Math.max(b.radius, b.reach || b.radius, 18);
          if (!b.carded) gpu.strokeCircle(b.x, b.y, reachR + 2, teamCol, 4, 1);
          const isSuperReady = (b.meter >= 100) || Boolean(b.superArm) || Boolean(b.superActive);
          if (isSuperReady && b.superArm && (b.superActive || b.equippedSuper?.key || 'stalwart') === 'colossus') {
            gpu.strokeCircle(b.x, b.y, Math.max(b.baseRadius ?? b.radius, P.SUPER?.colossusRadius || 56.25), '#ffe043cc', 2, 1, 5, 5);
          }
          if (i < 3) drawImpulseWebGL(b, fieldPlans[i], home);
        });
        const sel = view.bodies[getSelected()];
        if (sel) gpu.strokeCircle(sel.x, sel.y, sel.radius + 8, text, 2, 1);
        if (ball) {
          gpu.strokeCircle(ball.x, ball.y, ball.radius, text, 2, 1);
          const hot = ballOnFire() || (ball.team === -1 && P.ballOnFire?.(ball));
          drawBallGlyph(ball.x, ball.y, ball.radius, ball.rotation + (view.portrait ? Math.PI / 2 : 0), hot, ball.strikerTeam);
        }
      }

      // Badge & UI Overlays (in exact badgeCanvas order)
      const drawShieldWebGL = (bx, by, iron, alpha = 1) => {
        const st = getStampCanvas(`guardShield:${iron ? 1 : 0}`, 32, 32, pxScale, g => {
          g.translate(16, 16); g.scale(1.1, 1.1); g.translate(-12, -12);
          g.fillStyle = iron ? '#c3ccd6' : '#4798ff'; g.fill(GUARD_SHIELD);
          if (iron) { g.strokeStyle = '#6b7785'; g.lineWidth = 1.5; g.stroke(GUARD_SHIELD); }
        });
        if (!st) return;
        gpu.pushTransform();
        gpu.translate(bx, by);
        if (view.portrait) gpu.rotate(Math.PI / 2);
        gpu.drawTexture(st.key, st.canvas, -16, -16, 32, 32, alpha);
        gpu.popTransform();
      };

      const drawSuperBadgeWebGL = (b, key) => {
        const superId = b.equippedSuper?.id ?? 0;
        const icon = superImages[superId];
        if (!icon?.complete || !icon.naturalWidth) return;
        const [c1] = SUPER_AURA_THEMES[key] || ['#ff7197'];
        const size = b.superActive || b.superArm ? 24 : 20, p = badgePoint(b);
        const st = getStampCanvas(`superBadge:${superId}:${size}:${c1}`, 34, 34, pxScale, g => {
          g.translate(17, 17);
          g.beginPath(); g.arc(0, 0, size / 2 + 2, 0, Math.PI * 2);
          g.fillStyle = '#0b0d10d9'; g.fill();
          g.lineWidth = 1.5; g.strokeStyle = c1; g.stroke();
          g.drawImage(icon, -size / 2, -size / 2, size, size);
        });
        if (!st) return;
        gpu.pushTransform();
        gpu.translate(p.x, p.y);
        if (view.portrait) gpu.rotate(Math.PI / 2);
        gpu.drawTexture(st.key, st.canvas, -17, -17, 34, 34, 1);
        gpu.popTransform();
      };

      if (overlayGuideMoves) {
        activeGuide.start.slice(0, 6).forEach(b => {
          const idx = activeGuide.start.indexOf(b);
          const plan = activeGuide.moves[idx];
          if (plan?.guard && !b.stunned) {
            drawShieldWebGL(b.x + b.radius * 0.65, b.y + b.radius * 0.65, Boolean(b.ironGuard), 0.85);
          }
          if ((plan?.superArm || b.superArm) && b.equippedSuper && b.meter >= 100 && !b.stunned) {
            drawSuperBadgeWebGL({ ...b, superArm: true }, b.equippedSuper.key);
          }
        });
      }

      for (const s of fx.shockwaves) {
        if (s.overlay) drawShockwaveItem(s);
      }

      // Guard Beat 2: directional inward-flexing shield arc on struck side of guarding skater
      if (fx.guardFlexes?.length && !reduced) {
        for (const fl of fx.guardFlexes) {
          const gb = fl.body || (fl.index >= 0 ? view.bodies[fl.index] : null);
          if (!gb) continue;
          const prog = 1 - Math.max(0, fl.life / fl.duration);
          const fade = (1 - prog) ** 1.2;
          const dentEnv = Math.sin(Math.min(1, prog / 0.28) * Math.PI * 0.5) * ((1 - prog) ** 1.35);
          const reachR = Math.max(gb.radius, gb.reach || gb.radius, 18);
          const dentPx = (2.4 + 5.2 * fl.strength) * dentEnv;
          const cx = gb.x - Math.cos(fl.angle) * dentPx;
          const cy = gb.y - Math.sin(fl.angle) * dentPx;
          const halfSpan = 0.52 + 0.38 * fl.strength;
          const shieldCol = fl.iron ? '#d8e6f3' : '#5aa6ff';
          gpu.strokeArc(cx, cy, reachR + 3, fl.angle - halfSpan, fl.angle + halfSpan, shieldCol, (3.2 + 2.8 * fl.strength) * (0.45 + 0.55 * fade), Math.min(1, fade * (0.62 + 0.36 * fl.strength)), true);
          if (fade > 0.22) {
            gpu.strokeArc(cx, cy, reachR + 2.2, fl.angle - halfSpan * 0.58, fl.angle + halfSpan * 0.58, '#ffffff', (1.6 + 1.4 * fl.strength) * fade, fade * 0.88, true);
          }
        }
      }

      // System #2: Contact-edge mark on the struck rim of the ball (flat square chord vs. sideways graze skim + Reach glint)
      if (fx.contactMarks?.length && !reduced) {
        for (const m of fx.contactMarks) {
          const prog = 1 - Math.max(0, m.life / m.duration);
          const fade = (1 - prog) ** 1.15;
          const bRef = m.ball || ball;
          const teamCol = m.team === 0 ? home : m.team === 1 ? away : '#ffffff';
          if (m.poke && m.player && fade > 0.12) {
            const pReach = Math.max(m.player.radius, m.player.reach || m.player.radius, 18) + 2;
            const span = 0.42 * (0.65 + 0.35 * fade);
            gpu.strokeArc(m.player.x, m.player.y, pReach, m.hitAngle - span, m.hitAngle + span, '#ffffff', 3.4 * fade, fade * 0.92, true);
            gpu.strokeArc(m.player.x, m.player.y, pReach + 2.2, m.hitAngle - span * 0.75, m.hitAngle + span * 0.75, teamCol, 2.2 * fade, fade * 0.78, true);
          }
          if (!bRef) continue;
          if (m.graze < 0.45) {
            // Square hit: bright contact mark flattening cleanly against the struck face of the ball
            const nx = Math.cos(m.faceAngle), ny = Math.sin(m.faceAngle);
            const tx = -ny, ty = nx;
            const pressIn = 1.6 * Math.sin(Math.min(1, prog / 0.35) * Math.PI * 0.5) * fade;
            const rx = bRef.x + nx * (bRef.radius - pressIn);
            const ry = bRef.y + ny * (bRef.radius - pressIn);
            const halfChord = (5.5 + 5.8 * m.strength) * (0.72 + 0.28 * (1 - prog * 0.5));
            gpu.strokeLine(rx - tx * halfChord, ry - ty * halfChord, rx + tx * halfChord, ry + ty * halfChord, teamCol, 5.2 * fade, fade * 0.85, true);
            gpu.strokeLine(rx - tx * halfChord * 0.78, ry - ty * halfChord * 0.78, rx + tx * halfChord * 0.78, ry + ty * halfChord * 0.78, '#ffffff', 2.8 * fade, fade * 0.98, true);
            gpu.fillCircle(rx, ry, (3.2 + 2.2 * m.strength) * fade, '#ffffff', fade * 0.95);
          } else {
            // Glancing graze: thin contact mark skimming sideways along the struck rim
            const sweepDir = m.tangentSign || 1;
            const slideStart = m.faceAngle + sweepDir * (0.55 * prog);
            const sweep = sweepDir * (0.68 + 0.52 * m.graze) * (0.55 + 0.45 * fade);
            gpu.drawTaperedSpinArc(bRef.x, bRef.y, bRef.radius + 1.2, slideStart, sweep, (2.2 + 1.5 * m.strength) * fade, teamCol, fade * 0.90);
            gpu.drawTaperedSpinArc(bRef.x, bRef.y, bRef.radius + 0.8, slideStart + sweep * 0.18, sweep * 0.72, 1.5 * fade, '#ffffff', fade * 0.96);
          }
        }
      }

      const nowOverlayMs = clockNow();
      for (const item of badgeOverlayQueue) {
        if (item.kind === 'super') drawSuperBadgeWebGL(item.b, item.key);
        else if (item.kind === 'guard') {
          const b = item.b;
          const gm = reduced ? { scale: 1, nx: 0, ny: 0 } : guardBadgeMotion(fx, item.index ?? -1, b, phase, nowOverlayMs);
          const gp = view.portrait ? { x: b.x - b.radius * 0.65 + gm.nx, y: b.y + b.radius * 0.65 + gm.ny } : { x: b.x + b.radius * 0.65 + gm.nx, y: b.y + b.radius * 0.65 + gm.ny };
          const sz = 32 * gm.scale;
          const st = getStampCanvas(`guardShield:${item.iron ? 1 : 0}`, 32, 32, pxScale, g => {
            g.translate(16, 16); g.scale(1.1, 1.1); g.translate(-12, -12);
            g.fillStyle = item.iron ? '#c3ccd6' : '#4798ff'; g.fill(GUARD_SHIELD);
            if (item.iron) { g.strokeStyle = '#6b7785'; g.lineWidth = 1.5; g.stroke(GUARD_SHIELD); }
          });
          if (st) {
            gpu.pushTransform();
            gpu.translate(gp.x, gp.y);
            if (view.portrait) gpu.rotate(Math.PI / 2);
            gpu.drawTexture(st.key, st.canvas, -sz / 2, -sz / 2, sz, sz, 1);
            gpu.popTransform();
          }
        }
      }

      if (fx.goalCall && doc?.createElement) {
        const call = fx.goalCall, gcColor = call.team ? away : home;
        const pop = reduced ? 1 : Math.min(1, call.t / 0.27);
        const scFactor = 1 + 2.70158 * (pop - 1) ** 3 + 1.70158 * (pop - 1) ** 2;
        const face = call.scorer >= 0 ? resolveSkaterArt(call.scorer) : null;
        const top = face ? 40 : 0;
        const callLabel = view.anonymous && call.scorer < 0 && call.label.endsWith(' WINS!') && ububallReplay?.ANONYMOUS
          ? `${ububallReplay.ANONYMOUS[call.team].toUpperCase()} WINS!`
          : call.label;
        const callName = view.anonymous && call.scorer >= 0 ? anonymousName(call.scorer) : call.name;
        const cacheKey = `${callLabel}\u0000${callName}\u0000${gcColor}\u0000${width || 1000}\u0000${face ? 1 : 0}`;
        let cache = fx.goalCallCache?.key === cacheKey && fx.goalCallCache.face === face ? fx.goalCallCache : null;
        if (!cache) {
          const sc = doc.createElement('canvas');
          const sctx = sc?.getContext?.('2d');
          if (sctx && typeof sctx.fillText === 'function') {
            sctx.font = '900 88px system-ui, sans-serif';
            const labelW = sctx.measureText(callLabel)?.width || 560;
            sctx.font = '900 34px system-ui, sans-serif';
            const nameW = callName ? (sctx.measureText(callName)?.width || 360) : 0;
            const halfW = Math.ceil(Math.max(150, labelW / 2, nameW / 2) + 76);
            const topExt = face ? 232 : 124;
            const botExt = (callName ? top + 92 : top + 58) + 76;
            const logicalW = halfW * 2, logicalH = topExt + botExt;
            sc.width = Math.max(1, Math.ceil(logicalW * pxScale));
            sc.height = Math.max(1, Math.ceil(logicalH * pxScale));
            sctx.setTransform(pxScale, 0, 0, pxScale, halfW * pxScale, topExt * pxScale);
            const write = (str, y, sz) => {
              sctx.font = `900 ${sz}px system-ui, sans-serif`; sctx.lineWidth = sz / 14; sctx.strokeStyle = gcColor;
              sctx.strokeText(str, 0, y); sctx.fillStyle = '#ffffff'; sctx.fillText(str, 0, y);
            };
            sctx.shadowColor = gcColor; sctx.shadowBlur = 30 * pxScale;
            if (face) {
              sctx.beginPath(); sctx.arc(0, -82, 74, 0, Math.PI * 2); sctx.fillStyle = gcColor; sctx.fill();
              sctx.shadowBlur = 0; sctx.drawImage(face, -66, -148, 132, 132);
              sctx.shadowBlur = 30 * pxScale;
            }
            sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
            write(callLabel, top, 88);
            if (callName) write(callName, top + 66, 34);
            cache = fx.goalCallCache = { key: cacheKey, face, canvas: sc, halfW, topExt, logicalW, logicalH, rev: ++rinkCacheGen };
          }
        }
        if (cache) {
          const alpha = Math.max(0, Math.min(1, (GOAL_CALL_SECONDS - call.t) / 0.5));
          gpu.pushTransform();
          gpu.translate(500, 300);
          if (view.portrait) gpu.rotate(Math.PI / 2);
          gpu.scale(scFactor, scFactor);
          gpu.drawTexture('goalCall:' + cache.key, cache.canvas, -cache.halfW, -cache.topExt, cache.logicalW, cache.logicalH, alpha, 0, cache.rev || 1);
          gpu.popTransform();
        }
      }

      // Foul warnings, offender alerts/checks, and yellow cards
      {
        const fieldFouls = playback?.viewFouls ?? getFouls();
        const predicted = phase === 'plan' ? predictionCache?.fouls : null;
        const drawAlertWebGL = (ax, ay, sz, alpha = 1) => {
          const st = getStampCanvas(`alert:${sz}`, 32, 32, pxScale, g => {
            g.translate(16, 16); g.scale(sz / 24, sz / 24); g.translate(-12, -12);
            g.fillStyle = '#0b0d10d9'; g.fill(ALERT);
            g.lineWidth = 2; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#ffb020'; g.stroke(ALERT);
          });
          if (!st) return;
          gpu.pushTransform();
          gpu.translate(ax, ay);
          if (view.portrait) gpu.rotate(Math.PI / 2);
          gpu.drawTexture(st.key, st.canvas, -16, -16, 32, 32, alpha);
          gpu.popTransform();
        };
        const drawCheckWebGL = (cx, cy, sz) => {
          const st = getStampCanvas(`check:${sz}`, 32, 32, pxScale, g => {
            g.translate(16, 16); g.scale(sz / 24, sz / 24);
            g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.fillStyle = '#0b0d10d9'; g.fill();
            g.translate(-12, -12); g.scale(0.8, 0.8); g.translate(3, 3);
            g.lineWidth = 3; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#3ddc84'; g.stroke(CHECK);
          });
          if (!st) return;
          gpu.pushTransform();
          gpu.translate(cx, cy);
          if (view.portrait) gpu.rotate(Math.PI / 2);
          gpu.drawTexture(st.key, st.canvas, -16, -16, 32, 32, 1);
          gpu.popTransform();
        };
        const drawWarnWebGL = (wx, wy, words, cleared = false) => {
          const ix = view.portrait ? wx + 13 : wx, iy = view.portrait ? wy : wy - 13;
          if (cleared) drawCheckWebGL(ix, iy, 24);
          else drawAlertWebGL(ix, iy, 24, 1);
          const wKey = words.join(' ');
          const st = getStampCanvas(`warnTxt:${wKey}:${text}`, 88, 36, pxScale, g => {
            g.translate(44, 4);
            g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = text;
            words.forEach((word, idx) => g.fillText(word, 0, 7 + idx * 12));
          });
          if (st) {
            gpu.pushTransform();
            gpu.translate(wx, wy);
            if (view.portrait) gpu.rotate(Math.PI / 2);
            gpu.drawTexture(st.key, st.canvas, -44, -4, 88, 36, 1);
            gpu.popTransform();
          }
        };
        for (const team of [0, 1]) {
          if (fieldFouls.crease[team]) drawWarnWebGL(team ? 970 : 30, 180, ['Goal', 'Camping'], predicted?.crease[team]);
        }
        if (stalling(fieldFouls)) {
          drawWarnWebGL(fieldFouls.corner % 2 ? 970 : 30, cornerWarningY(fieldFouls), ['Corner', 'Stalling'], predicted?.corner);
        }
        const flash = reduced ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(clockNow() / 1000 * Math.PI * 2.4));
        const creasing = new Set(view.bodies.slice(0, 6).filter(b => fieldFouls.crease[b.team] && isCreasing(b, b.team)));
        for (const b of offenders(fieldFouls)) {
          if (b.carded) continue;
          const ox = b.x + b.radius * 0.8, oy = view.portrait ? b.y + b.radius * 0.8 : b.y - b.radius * 0.8;
          if (predicted && (creasing.has(b) ? predicted.left.has(view.bodies.indexOf(b)) : predicted.corner)) drawCheckWebGL(ox, oy, 24);
          else drawAlertWebGL(ox, oy, 26, flash);
        }
        for (const b of view.bodies.slice(0, 6)) {
          if (!b.carded) continue;
          const st = getStampCanvas('yellowCard', 24, 28, pxScale, g => {
            g.translate(12, 14);
            g.beginPath(); g.roundRect(-6, -8, 12, 16, 2); g.fillStyle = '#ffd60a'; g.fill();
            g.lineWidth = 1.5; g.strokeStyle = '#0b0d10'; g.stroke();
          });
          if (st) {
            const cr = b.radius * 0.7;
            gpu.pushTransform();
            gpu.translate(b.x + cr, view.portrait ? b.y + cr : b.y - cr);
            gpu.rotate((view.portrait ? Math.PI / 2 : 0) + 0.2);
            gpu.drawTexture(st.key, st.canvas, -12, -14, 24, 28, 1);
            gpu.popTransform();
          }
        }
      }

      // Popups ("Save!", "Big save!", "Trap!", "Spin strike!", "Assist", "Yellow card")
      if (fx.popups.length && doc?.createElement) {
        for (const p of fx.popups) {
          const duration = p.duration || 1.2;
          const age = 1 - p.life / duration;
          const u = reduced ? 1 : Math.min(1, age / 0.2);
          const scFactor = reduced ? 1 : 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
          const col = p.team ? away : home;
          const alpha = age < 0.7 ? 1 : Math.max(0, (1 - age) / 0.3);
          const key = `${p.text}\u0000${col}\u0000${width || 1000}`;
          let sprite = p._sprite?.key === key ? p._sprite : null;
          if (!sprite) {
            const sc = doc.createElement('canvas');
            const sctx = sc?.getContext?.('2d');
            if (sctx && typeof sctx.fillText === 'function') {
              sctx.font = '900 26px system-ui, sans-serif';
              const tw = sctx.measureText(p.text)?.width || 220;
              const halfW = Math.ceil(Math.max(80, tw / 2) + 32), halfH = 44;
              const lw = halfW * 2, lh = halfH * 2;
              sc.width = Math.max(1, Math.ceil(lw * pxScale));
              sc.height = Math.max(1, Math.ceil(lh * pxScale));
              sctx.setTransform(pxScale, 0, 0, pxScale, halfW * pxScale, halfH * pxScale);
              sctx.font = '900 26px system-ui, sans-serif'; sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
              sctx.shadowColor = col; sctx.shadowBlur = 12 * pxScale;
              sctx.lineWidth = 4; sctx.strokeStyle = col; sctx.strokeText(p.text, 0, 0);
              sctx.fillStyle = '#ffffff'; sctx.fillText(p.text, 0, 0);
              sprite = p._sprite = { key, canvas: sc, halfW, halfH, lw, lh };
            }
          }
          if (sprite) {
            gpu.pushTransform();
            gpu.translate(p.x, reduced ? p.y : p.y - age * 22);
            if (view.portrait) gpu.rotate(Math.PI / 2);
            gpu.scale(scFactor, scFactor);
            gpu.drawTexture('popup:' + sprite.key, sprite.canvas, -sprite.halfW, -sprite.halfH, sprite.lw, sprite.lh, alpha);
            gpu.popTransform();
          }
        }
      }

      drawParticlesWebGL(true);

      if (goalReplay) {
        const slow = goalReplay.played >= goalReplay.total || ububallMatch.replaySpeed(goalReplay.total - goalReplay.played) < 1;
        const labelStr = slow ? 'REPLAY · SLOW MOTION' : 'REPLAY';
        const fontPx = view.portrait ? 16 : 18;
        const st = getStampCanvas(`replayMark:${labelStr}:${fontPx}:${text}`, 280, 32, pxScale, g => {
          g.translate(140, 16);
          g.font = `bold ${fontPx}px system-ui, sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = text;
          g.fillText(labelStr, 0, 0);
        });
        if (st) {
          gpu.pushTransform();
          gpu.translate(view.portrait ? 990 : 500, view.portrait ? 300 : 32);
          if (view.portrait) gpu.rotate(Math.PI / 2);
          gpu.drawTexture(st.key, st.canvas, -140, -16, 280, 32, 1);
          gpu.popTransform();
        }
      }

      if (vf?.scorebugLayer) {
        gpu.resetTransform();
        gpu.setClip(0);
        gpu.setBlend('normal');
        const bugLogH = (vf.scorebugLayer.height / vf.height) * vf.logH;
        gpu.drawTexture('video:scorebug', vf.scorebugLayer, vf.offX, vf.offY, vf.logW, bugLogH, 1, 0, vf.scorebugRev || 0);
      }

      gpu.endFrame();
      return { width: frameW, height: frameH, colors };
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
      const colors = getThemeColors();
      const gpu = resolveRendererBackend(view);
      if (gpu) {
        const gpuRes = drawSceneWebGL(gpu, view, fx, phase, playback, fieldPlans, width, height, isCollectionPortrait, colors);
        if (gpuRes) return gpuRes;
        resolveRendererBackend(view);
      }
      if (!view.ctx) return { width, height, colors };
      const target2dCanvas = view._active2dCanvas || view.canvas;
      if (target2dCanvas.width !== width || target2dCanvas.height !== height) { target2dCanvas.width = width; target2dCanvas.height = height; }
      if (target2dCanvas !== view.canvas && (view.canvas.width !== width || view.canvas.height !== height)) {
        view.canvas.width = width; view.canvas.height = height;
      }
      if (!isCollectionPortrait && view.badgeCanvas && (view.badgeCanvas.width !== width || view.badgeCanvas.height !== height)) {
        view.badgeCanvas.width = width; view.badgeCanvas.height = height;
      }
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
        const expand = (s.dramatic || s.hipClip || s.check || s.spinStrike || s.spinTwirl || s.koCone || s.colossusGrowth) ? 1 - (1 - progress) ** 2.6 : progress;
        const fade = (s.dramatic || s.hipClip || s.check || s.spinStrike || s.spinTwirl || s.koCone || s.colossusGrowth) ? (1 - progress) ** 1.25 : 1 - progress;
        const r = s.currentRadius + (s.maxRadius - s.currentRadius) * expand;
        const targetCtx = s.overlay && view.badgeCtx ? view.badgeCtx : view.ctx;
        const waveColor = s.color || (s.team === 0 ? home : away);
        const baseW = s.width || (s.overlay ? 4.5 : 6);
        targetCtx.save();
        if (s.colossusGrowth) {
          const cx = s.target?.x ?? s.x, cy = s.target?.y ?? s.y;
          const a = Math.max(0, fade * 0.90);
          targetCtx.lineCap = 'round';
          targetCtx.setLineDash([12, 8]);
          targetCtx.beginPath();
          targetCtx.arc(cx, cy, r, 0, Math.PI * 2);
          targetCtx.strokeStyle = waveColor;
          targetCtx.lineWidth = Math.max(1.2, baseW * fade);
          targetCtx.globalAlpha = a;
          targetCtx.stroke();
          targetCtx.setLineDash([]);
          if (fade > 0.18) {
            targetCtx.beginPath();
            targetCtx.arc(cx, cy, Math.max(2, r - 4), 0, Math.PI * 2);
            targetCtx.strokeStyle = '#fff5b8';
            targetCtx.lineWidth = Math.max(1, baseW * 0.45 * fade);
            targetCtx.globalAlpha = a * 0.72;
            targetCtx.stroke();
          }
          const rayCount = 12, rot = s.startAngle || 0, rayLen = 18 + 14 * expand;
          targetCtx.lineWidth = Math.max(1.2, 2.8 * fade);
          targetCtx.globalAlpha = a * 0.92;
          for (let k = 0; k < rayCount; k++) {
            const ang = rot + (k / rayCount) * Math.PI * 2;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const r0 = Math.max(2, r * 0.90), r1 = r + rayLen;
            targetCtx.strokeStyle = k % 2 === 0 ? '#ffffff' : waveColor;
            targetCtx.beginPath();
            targetCtx.moveTo(cx + ca * r0, cy + sa * r0);
            targetCtx.lineTo(cx + ca * r1, cy + sa * r1);
            targetCtx.stroke();
          }
          targetCtx.restore();
          return;
        }
        if (s.spinTwirl) {
          const tx = s.target?.x ?? s.x, ty = s.target?.y ?? s.y;
          const dir = s.spinDir || 1;
          const twirlR = s.currentRadius + (s.maxRadius - s.currentRadius) * Math.sin(Math.min(1, progress * 1.15) * Math.PI * 0.65);
          const rot = (s.startAngle || 0) + dir * (progress ** 0.72) * Math.PI * 3.8;
          const bladeW = Math.max(1.4, baseW * (0.5 + 0.5 * fade));
          const peakAlpha = Math.max(0, fade * 0.94);
          targetCtx.beginPath();
          targetCtx.arc(tx, ty, twirlR * 0.96, 0, Math.PI * 2);
          targetCtx.strokeStyle = waveColor;
          targetCtx.lineWidth = Math.max(1, bladeW * 0.45);
          targetCtx.globalAlpha = peakAlpha * 0.35;
          targetCtx.stroke();
          for (let bIdx = 0; bIdx < 3; bIdx++) {
            const a0 = rot + (bIdx * Math.PI * 2) / 3;
            fillTaperedSpinArc(targetCtx, tx, ty, twirlR, a0, 1.38 * dir, bladeW, waveColor, peakAlpha);
          }
          for (let bIdx = 0; bIdx < 2; bIdx++) {
            const a0 = rot + 0.45 * dir + bIdx * Math.PI;
            fillTaperedSpinArc(targetCtx, tx, ty, twirlR * 0.68, a0, 1.55 * dir, bladeW * 0.62, '#ffffff', peakAlpha * 0.88);
          }
          targetCtx.restore();
          return;
        }
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

        const coil2D = aimCoilPose(b, fieldPlans?.[i], phase, isReducedMotion());
        if (!b.carded) {
          circle(b.x, b.y, reachR + 2, i < 3 ? home : away, 4);
          if (coil2D) {
            const backAng = coil2D.angle + Math.PI, halfSpan = 0.34 + 0.44 * coil2D.power;
            view.ctx.save();
            view.ctx.beginPath();
            view.ctx.arc(b.x, b.y, Math.max(8, b.radius - 1.2), backAng - halfSpan, backAng + halfSpan);
            view.ctx.strokeStyle = '#ffffff';
            view.ctx.lineWidth = 2.2;
            view.ctx.lineCap = 'round';
            view.ctx.globalAlpha = 0.18 + 0.36 * coil2D.power;
            view.ctx.stroke();
            view.ctx.restore();
          }
        }

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
        if ((inAction && b.guarding) || (phase === 'plan' && fieldPlans?.[i]?.guard)) {
          const iron = phase === 'plan'
            ? Boolean(predictionCache?.data.guards.some(g => g.index === i && g.held))
            : Boolean(b.ironGuard);
          const gm = isReducedMotion() ? { scale: 1, nx: 0, ny: 0 } : guardBadgeMotion(fx, i, b, phase, clockNow());
          drawGuardShield(view.badgeCtx, b, view.portrait, iron, gm.scale, gm.nx, gm.ny);
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
        const cx2D = b.x + (coil2D ? coil2D.dx : 0), cy2D = b.y + (coil2D ? coil2D.dy : 0);
        const transform = ubuWarped
          ? `translate(${cx2D / 1000 * renderWidth}px, ${cy2D / 600 * renderHeight}px) translate(-50%, -50%) rotate(${ubuWarpAngle}rad) scale(${ubuScaleX.toFixed(4)}, ${ubuScaleY.toFixed(4)}) rotate(${rot - ubuWarpAngle}rad)`
          : coil2D && (coil2D.scaleX !== 1 || coil2D.scaleY !== 1)
            ? `translate(${cx2D / 1000 * renderWidth}px, ${cy2D / 600 * renderHeight}px) translate(-50%, -50%) rotate(${coil2D.angle}rad) scale(${coil2D.scaleX.toFixed(4)}, ${coil2D.scaleY.toFixed(4)}) rotate(${rot - coil2D.angle}rad)`
            : `translate(${cx2D / 1000 * renderWidth}px, ${cy2D / 600 * renderHeight}px) translate(-50%, -50%) rotate(${rot}rad)`;

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

      const ball = view.bodies[6];
      const drawBallFace2D = () => {
        if (!ball) return;
        const size = ball.radius * 1.7;
        const hot = ballOnFire() || (ball.team === -1 && P.ballOnFire?.(ball));
        const paceTeam = ball.strikerTeam;
        view.ctx.save(); view.ctx.translate(ball.x, ball.y); view.ctx.rotate(ball.rotation + (view.portrait ? Math.PI / 2 : 0));
        if (hot && paceTeam !== undefined && paceTeam >= 0) {
          const teamColor = paceTeam === 0 ? home : away;
          drawBallFace(view.ctx, size, teamColor, teamColor);
        } else if (ballMark.complete && ballMark.naturalWidth) {
          view.ctx.drawImage(ballMark, -size / 2, -size / 2, size, size);
        } else {
          drawBallFace(view.ctx, size, '#F8F7F4', '#FF7197');
        }
        view.ctx.restore();
      };
      if (ball) {
        const fw = fx.fireWarp && fx.fireWarp.life > 0 && !isReducedMotion() ? fx.fireWarp : null;
        const tw = !fw && fx.ballTapWarp && fx.ballTapWarp.life > 0 && !isReducedMotion() ? fx.ballTapWarp : null;
        let warpScaleX = 1, warpScaleY = 1, warpAngle = 0;
        if (tw) {
          const tp = 1 - Math.max(0, tw.life / tw.duration);
          const env = Math.sin(Math.min(1, tp / 0.35) * Math.PI * 0.5) * ((1 - tp) ** 1.3);
          const amt = env * 0.11 * (tw.strength || 0.6);
          warpScaleX = 1 - amt;
          warpScaleY = 1 + amt * 0.78;
          warpAngle = Math.atan2(tw.ny || 0, tw.nx || 1);
        }
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
        if (fw || tw) {
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
        drawBallFace2D();
        view.ctx.restore();
        view.bodies.slice(0, 6).forEach(b => { if (!b.carded) drawSpin(b, b.team ? away : home); });
        drawSpin(ball, text);
        if (!isReducedMotion()) {
          if (fx.guardFlexes?.length) {
            for (const fl of fx.guardFlexes) {
              const gb = fl.body || (fl.index >= 0 ? view.bodies[fl.index] : null);
              if (!gb) continue;
              const prog = 1 - Math.max(0, fl.life / fl.duration);
              const fade = (1 - prog) ** 1.2;
              const dentEnv = Math.sin(Math.min(1, prog / 0.28) * Math.PI * 0.5) * ((1 - prog) ** 1.35);
              const reachR = Math.max(gb.radius, gb.reach || gb.radius, 18);
              const dentPx = (2.4 + 5.2 * fl.strength) * dentEnv;
              const cx = gb.x - Math.cos(fl.angle) * dentPx, cy = gb.y - Math.sin(fl.angle) * dentPx;
              const halfSpan = 0.52 + 0.38 * fl.strength;
              view.ctx.save();
              view.ctx.lineCap = 'round';
              view.ctx.beginPath();
              view.ctx.arc(cx, cy, reachR + 3, fl.angle - halfSpan, fl.angle + halfSpan);
              view.ctx.strokeStyle = fl.iron ? '#d8e6f3' : '#5aa6ff';
              view.ctx.lineWidth = (3.2 + 2.8 * fl.strength) * (0.45 + 0.55 * fade);
              view.ctx.globalAlpha = Math.min(1, fade * (0.62 + 0.36 * fl.strength));
              view.ctx.stroke();
              view.ctx.restore();
            }
          }
          if (fx.contactMarks?.length) {
            for (const m of fx.contactMarks) {
              const prog = 1 - Math.max(0, m.life / m.duration);
              const fade = (1 - prog) ** 1.15;
              const bRef = m.ball || ball;
              const teamCol = m.team === 0 ? home : m.team === 1 ? away : '#ffffff';
              view.ctx.save();
              view.ctx.lineCap = 'round';
              if (m.poke && m.player && fade > 0.12) {
                const pReach = Math.max(m.player.radius, m.player.reach || m.player.radius, 18) + 2;
                const span = 0.42 * (0.65 + 0.35 * fade);
                view.ctx.beginPath();
                view.ctx.arc(m.player.x, m.player.y, pReach, m.hitAngle - span, m.hitAngle + span);
                view.ctx.strokeStyle = '#ffffff';
                view.ctx.lineWidth = 3.2 * fade;
                view.ctx.globalAlpha = fade * 0.92;
                view.ctx.stroke();
              }
              if (m.graze < 0.45) {
                const nx = Math.cos(m.faceAngle), ny = Math.sin(m.faceAngle);
                const tx = -ny, ty = nx;
                const pressIn = 1.6 * Math.sin(Math.min(1, prog / 0.35) * Math.PI * 0.5) * fade;
                const rx = bRef.x + nx * (bRef.radius - pressIn), ry = bRef.y + ny * (bRef.radius - pressIn);
                const halfChord = (5.5 + 5.8 * m.strength) * (0.72 + 0.28 * (1 - prog * 0.5));
                line(rx - tx * halfChord, ry - ty * halfChord, rx + tx * halfChord, ry + ty * halfChord, teamCol, 5.0 * fade);
                line(rx - tx * halfChord * 0.78, ry - ty * halfChord * 0.78, rx + tx * halfChord * 0.78, ry + ty * halfChord * 0.78, '#ffffff', 2.6 * fade);
              } else {
                const sweepDir = m.tangentSign || 1;
                const a0 = m.faceAngle + sweepDir * (0.55 * prog);
                const a1 = a0 + sweepDir * (0.68 + 0.52 * m.graze) * (0.55 + 0.45 * fade);
                view.ctx.beginPath();
                view.ctx.arc(bRef.x, bRef.y, bRef.radius + 1.0, sweepDir > 0 ? a0 : a1, sweepDir > 0 ? a1 : a0);
                view.ctx.strokeStyle = '#ffffff';
                view.ctx.lineWidth = (2.0 + 1.2 * m.strength) * fade;
                view.ctx.globalAlpha = fade * 0.94;
                view.ctx.stroke();
              }
              view.ctx.restore();
            }
          }
        }
      }

      drawParticles(home, away);
      let heatMirageDrawn = false;
      function drawHeatMirage(cx, cy, mirageR, strength, timeVal, isImpact = false) {
        if (strength <= 0.02 || isReducedMotion() || bench?.flags.noMirage) return;
        const padding = 12;
        const rx = Math.max(0, cx - mirageR - padding), ry = Math.max(0, cy - mirageR - padding);
        const rw = Math.min(1000, cx + mirageR + padding) - rx;
        const rh = Math.min(600, cy + mirageR + padding) - ry;
        if (rw <= 0 || rh <= 0) return;
        const sx = width / 1000, sy = height / 600;
        // Snapshot only the affected region after the live scene has been drawn.
        // The scratch surface stays small and is reused; no CPU pixel processing.
        const size = Math.min(160, Math.max(64, Math.ceil(64 * Math.min(sx, sy) / 32) * 32));
        if (!doc?.createElement) return;
        heatMirageDrawn = true;
        fx.mirageCanvas ||= doc.createElement('canvas');
        const mc = fx.mirageCanvas;
        if (mc.width !== size || mc.height !== size) { mc.width = size; mc.height = size; }
        const mctx = fx.mirageCtx ||= mc.getContext('2d', { willReadFrequently: true });
        mctx.clearRect(0, 0, size, size);
        mctx.drawImage(view._active2dCanvas || view.canvas, rx * sx, ry * sy, rw * sx, rh * sy, 0, 0, size, size);
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

        // Replace the local image with refracted pixels; opacity is not the heat effect.
        view.ctx.save();
        view.ctx.beginPath();
        view.ctx.roundRect(60, 60, 880, 480, 100);
        view.ctx.clip();
        view.ctx.beginPath();
        view.ctx.arc(cx, cy, mirageR, 0, Math.PI * 2);
        view.ctx.clip();

        // 1. Central convective plume core lens
        const coreR = mirageR * (isImpact ? 0.42 + timeVal * 0.44 : 0.65);
        const coreZoom = 1 + (isImpact ? 0.18 * strength * Math.cos(timeVal * Math.PI * 1.5) : 0.24 * strength * Math.sin(timeVal * 5.5));
        const coreUpdraft = isImpact ? 0 : -4 * strength * Math.sin(timeVal * 5.5);
        view.ctx.save();
        traceBulbousLobe(view.ctx, cx, cy, coreR, timeVal, 0);
        view.ctx.clip();
        view.ctx.translate(cx, cy + coreUpdraft);
        view.ctx.scale(coreZoom, coreZoom);
        view.ctx.translate(-cx, -cy);
        view.ctx.globalAlpha = 1;
        view.ctx.drawImage(mc, 0, 0, size, size, rx, ry, rw, rh);
        view.ctx.restore();

        // 2. Swirling bulbous convective eddies / thermal bubbles
        const numLobes = 2;
        for (let k = 0; k < numLobes; k++) {
          const swirlSpeed = isImpact ? 12 : 6.5;
          const baseAngle = (k / numLobes) * Math.PI * 2;
          const orbitAngle = baseAngle + timeVal * swirlSpeed * (k % 2 === 0 ? 1.0 : 0.82);
          const orbitR = mirageR * (0.34 + 0.24 * Math.sin(timeVal * 5.2 + k * 1.8));
          const updraft = isImpact ? 0 : (Math.sin(timeVal * 6.5 + k * 2.0) * 0.20 - 0.10) * mirageR;
          const bx = cx + Math.cos(orbitAngle) * orbitR;
          const by = cy + Math.sin(orbitAngle) * orbitR * 0.86 + updraft;
          const br = mirageR * (isImpact ? 0.36 + 0.14 * Math.cos(timeVal * 7 + k) : 0.42 + 0.12 * Math.sin(timeVal * 4.5 + k));

          const lobeZoom = 1 + (isImpact ? 0.20 : 0.18) * strength * (0.85 + 0.35 * Math.sin(timeVal * 6.8 + k * 1.5));
          const swirlDir = k % 2 === 0 ? 1 : -1;
          const tanAngle = Math.atan2(by - cy, bx - cx) + (Math.PI / 2) * swirlDir;
          const drift = (isImpact ? 12 : 11) * strength;
          const dx = Math.cos(tanAngle) * drift;
          const dy = Math.sin(tanAngle) * drift - (isImpact ? 0 : 1.2 * strength);

          view.ctx.save();
          traceBulbousLobe(view.ctx, bx, by, br, timeVal, k + 1);
          view.ctx.clip();
          view.ctx.translate(bx + dx, by + dy);
          view.ctx.scale(lobeZoom, lobeZoom);
          view.ctx.translate(-bx, -by);
          view.ctx.globalAlpha = 1;
          view.ctx.drawImage(mc, 0, 0, size, size, rx, ry, rw, rh);
          view.ctx.restore();
        }

        view.ctx.restore();
      }

      const heatBall = view.bodies[6];
      if (fx.fireWarp && fx.fireWarp.life > 0 && !isReducedMotion()) {
        const fw = fx.fireWarp;
        const wp = 1 - Math.max(0, fw.life / fw.duration);
        const fade = (1 - wp) ** 1.15;
        const mirageR = 46 + wp * 44;
        drawHeatMirage(fw.x, fw.y, mirageR, fade * (bench?.warpScale ?? 1), wp, true);
      }
      if (heatBall && ballOnFire() && !isReducedMotion()) {
        const fwNear = fx.fireWarp && fx.fireWarp.life > 0 && Math.hypot(heatBall.x - fx.fireWarp.x, heatBall.y - fx.fireWarp.y) < 32;
        if (!fwNear) {
          const mirageR = Math.max(36, (heatBall.radius || 14) * 2.8);
          const heatTime = fx.heatTime || 0;
          const flare = Math.max(0, fx.ballWarpFlare || 0);
          drawHeatMirage(heatBall.x, heatBall.y, mirageR, (0.20 + 0.75 * flare) * (bench?.warpScale ?? 1), heatTime, false);
        }
      }

      if (phase === 'plan' && heatMirageDrawn) {
        drawPrediction(home, away);
        view.bodies.slice(0, 6).forEach((b, i) => {
          const reachR = Math.max(b.radius, b.reach || b.radius, 18);
          if (!b.carded) circle(b.x, b.y, reachR + 2, i < 3 ? home : away, 4);
          const isSuperReady = (b.meter >= 100) || Boolean(b.superArm) || Boolean(b.superActive);
          if (isSuperReady && b.superArm && (b.superActive || b.equippedSuper?.key || 'stalwart') === 'colossus') {
            view.ctx.save();
            view.ctx.setLineDash([5, 5]);
            circle(b.x, b.y, Math.max(b.baseRadius ?? b.radius, P.SUPER?.colossusRadius || 56.25), '#ffe043cc', 2);
            view.ctx.restore();
          }
          if (i < 3) drawImpulse(b, fieldPlans[i], home);
        });
        const sel = view.bodies[getSelected()];
        if (sel) circle(sel.x, sel.y, sel.radius + 8, text, 2);
        if (ball) {
          circle(ball.x, ball.y, ball.radius, text, 2);
          drawBallFace2D();
        }
      }

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
      ensureEntrySprites,
      releaseViewGpu,
      getRendererInfo: (v = getView()) => {
        const g = v?._webgl;
        const active = Boolean(g && !g.isLost && v?.canvas?._webglComposite);
        return {
          backend: active ? 'webgl2' : 'canvas2d',
          contextLost: Boolean(g?.isLost),
          drawCalls: active ? g.lastDrawCalls : 0,
          textures: active ? g.textureCount : 0,
          gpuMs: active ? g.lastGpuMs : null
        };
      },
      handleCollision,
      handleWall,
      handleSuper,
      handleShockwave,
      handleLaunch,
      triggerGuardToggle,
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
