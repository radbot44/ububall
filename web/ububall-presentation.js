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
    particles.push({ x: f.x, y: f.y, px: f.x, py: f.y, vx: 0, vy: 0, team: f.team, life: .3, duration: .3, flash: true, overlay: true });
    for (let k = 0; k < 72 && particles.length < 700; k++) {
      const angle = f.ring ? k / 72 * Math.PI * 2 : Math.random() * Math.PI * 2;
      const speed = f.ring ? 210 : 60 + Math.random() * 200, life = 1 + Math.random() * .7;
      particles.push({ x: f.x, y: f.y, px: f.x, py: f.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, team: f.team,
        color: k % 4 === 0 ? '#ffffff' : k % 5 === 0 ? '#ffd76b' : null, life, duration: life,
        celebration: true, overlay: true, crackle: Math.random() < .3 });
    }
  }

  function crackle(p, particles) {
    for (let k = 0; k < 3 && particles.length < 700; k++) {
      const angle = Math.random() * Math.PI * 2, life = .12 + Math.random() * .1;
      particles.push({ x: p.x, y: p.y, px: p.x, py: p.y, vx: Math.cos(angle) * 60, vy: Math.sin(angle) * 60,
        team: -1, color: '#ffffff', life, duration: life, overlay: true });
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
      const drag = Math.exp(-dt * (p.celebration ? 1.2 : 4));
      p.vx *= drag; p.vy = p.vy * drag + (p.celebration ? 95 : 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const f = fireworks[i];
      if ((f.delay -= dt) > 0) continue;
      f.y += f.vy * dt; f.vy += 320 * dt; f.fuse -= dt;
      if (particles.length < 700) particles.push({ x: f.x, y: f.y, px: f.x, py: f.y, vx: (Math.random() - .5) * 30, vy: 30,
        team: f.team, color: '#ffe9b0', life: .3, duration: .3, overlay: true });
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

  function updatePopups(dt, popups, reduced = false) {
    if (reduced) { popups.length = 0; return; }
    for (let i = popups.length - 1; i >= 0; i--) if ((popups[i].life -= dt) <= 0) popups.splice(i, 1);
  }

  function drawPopups(badgeCtx, popups, isPortrait, width, home, away) {
    for (const p of popups) {
      const duration = p.duration || 1.2;
      const age = 1 - p.life / duration, t = Math.min(1, age / .2), scale = 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
      const color = p.team ? away : home;
      badgeCtx.save(); badgeCtx.translate(p.x, p.y - age * 22); if (isPortrait) badgeCtx.rotate(Math.PI / 2); badgeCtx.scale(scale, scale);
      badgeCtx.globalAlpha = age < .7 ? 1 : (1 - age) / .3;
      badgeCtx.font = '900 26px system-ui, sans-serif'; badgeCtx.textAlign = 'center'; badgeCtx.textBaseline = 'middle';
      badgeCtx.shadowColor = color; badgeCtx.shadowBlur = 12 * width / 1000;
      badgeCtx.lineWidth = 4; badgeCtx.strokeStyle = color; badgeCtx.strokeText(p.text, 0, 0);
      badgeCtx.fillStyle = '#ffffff'; badgeCtx.fillText(p.text, 0, 0);
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
    const effRadius = isColossus ? Math.min(60, body.radius * (body.superActive === 'colossus' ? 1 : (P.SUPER?.colossusRadius || 1.8))) : body.radius;
    const superScale = isColossus ? (P.SUPER?.colossusLaunch || 0.75) : (isStalwart ? (P.SUPER?.stalwartLaunch || 0.5) : 1);
    const agility = (body.sizeMult || 1) ** (P.SIZE?.launch ?? -0.28);
    const daze = 1 - (P.dazeSlow ? P.dazeSlow(body) : 0);
    const scale = 110 * ((body.impulse || P.IMPULSE) / P.IMPULSE) * superScale * agility * daze;
    const ringR = Math.max(effRadius, body.reach || effRadius, 18) + 2;
    const distance = ringR + scale * plan.power;
    return { ringR, scale, distance, x: body.x + Math.cos(plan.angle) * distance, y: body.y + Math.sin(plan.angle) * distance,
      visible: plan.power > 0 && !body.stunned };
  }

  // A gain flashes a glint at the bar's growing end; a full bar shimmers.
  function setMeterFill(fill, meter) {
    const value = Math.min(100, Math.max(0, meter || 0)), previous = Number(fill.dataset.value ?? value);
    fill.style.width = value + '%'; fill.dataset.value = value;
    if (value > previous + .2) { fill.classList.remove('gain'); void fill.offsetWidth; fill.classList.add('gain'); }
    fill.classList.toggle('full', value >= 100);
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
    const paceShare = ball => Math.max(Math.hypot(ball.vx, ball.vy), ball.pace || 0) / P.MAX_SPEED;
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
          gameAudio()?.playCarve?.({ volume: Math.min(0.55, 0.18 + 0.36 * strength) });
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

    function flames(x, y, spread, vx, vy, amount) {
      const fx = getEffects();
      for (let k = Math.ceil(amount); k > 0 && fx.particles.length < 380; k--) {
        const px = x + (Math.random() - .5) * spread, py = y + (Math.random() - .5) * spread, life = .18 + Math.random() * .22;
        fx.particles.push({ x: px, y: py, px, py, vx: vx + (Math.random() - .5) * 50, vy: vy + (Math.random() - .5) * 50,
          team: -1, color: ['#fff3b0', '#ffc43d', '#ff7a1a', '#ff3b1a'][Math.floor(Math.random() * 4)], life, duration: life, flame: 10 + Math.random() * 12 });
      }
    }

    function sparkBall(ball, dt) {
      if (!ball) return;
      const fx = getEffects();
      const speed = Math.hypot(ball.vx, ball.vy), share = paceShare(ball);
      fx.fireTime = P.ballOnFire(ball) ? fx.fireTime + dt : 0;
      if (ballOnFire() && !fx.sizzle) fx.sizzle = gameAudio()?.playSizzle?.() || null;
      else if (!ballOnFire()) quench();
      const level = Math.max(fx.ballFlare, (share - HEAT.red) / (HEAT.redHot - HEAT.red));
      const ux = speed ? ball.vx / speed : 0, uy = speed ? ball.vy / speed : -1;
      if (ballOnFire()) flames(ball.x - ux * ball.radius * .5, ball.y - uy * ball.radius * .5, ball.radius * 1.4, -ball.vx * .12, -ball.vy * .12, dt * 120);
      if (level <= 0 || speed < 1) return;
      const count = Math.ceil(dt * 90 * Math.min(1, level));
      for (let k = 0; k < count && fx.particles.length < 360; k++) {
        const x = ball.x - ux * ball.radius, y = ball.y - uy * ball.radius, life = .2 + Math.random() * .2;
        fx.particles.push({ x, y, px: x, py: y, vx: -ball.vx * .25 + (Math.random() - .5) * 160, vy: -ball.vy * .25 + (Math.random() - .5) * 160,
          team: -1, color: Math.random() < .5 ? '#ffb347' : '#fff1c1', life, duration: life });
      }
    }

    function burnNet(dt) {
      const fx = getEffects(), view = getView();
      if (!fx.netFire?.lit || isReducedMotion()) return;
      const back = fx.netFire.mouth < 500 ? fx.netFire.mouth - P.rink.goalDepth : fx.netFire.mouth + P.rink.goalDepth;
      flames((fx.netFire.mouth + back) / 2, 300, P.rink.goalDepth, 0, 0, dt * 40);
      flames(fx.netFire.mouth, 300, 30, 0, 0, dt * 20);
      for (const y of [P.rink.goalTop, P.rink.goalBottom]) flames((fx.netFire.mouth + back) / 2, y, 30, 0, 0, dt * 15);
      const ball = view.bodies[6];
      if (ball) flames(ball.x, ball.y, ball.radius * 1.2, 0, 0, dt * 60);
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
          audio.playUbuMove?.({ id: i, speed, mass: b.mass || 3, radius: b.radius || 25, slot: i });
          audio.playSpin?.({ id: i, omega: b.omega || 0, radius: b.radius || 25, slot: i });
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
              audio.playSlipstream({ draft, volume: Math.min(0.75, 0.24 + 0.48 * draft), duration: 0.2 });
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
            pan: Math.max(-0.5, Math.min(0.5, ((ball.x - 500) / 500) * 0.35)),
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

    function clearEffects() {
      const fx = getEffects(), view = getView(), rinkWrap = getRinkWrap();
      if (!view.field) onClearPostGoal?.();
      fx.trails.forEach(trail => { trail.length = 0; });
      fx.particles.length = fx.fireworks.length = fx.shockwaves.length = 0;
      fx.skids.length = fx.skidState.length = fx.burns.length = fx.ripples.length = fx.pings.length = 0;
      fx.popups.length = 0;
      fx.burnState.path = null; fx.fireTime = 0; quench();
      if (fx.netFire) fx.netFire.lit = false;
      fx.shake = fx.shakeX = fx.shakeY = 0; if (!view.field && rinkWrap) rinkWrap.style.translate = '';
      fx.danger[0] = fx.danger[1] = fx.ballFlare = fx.kickoffGlow = 0; fx.goalSweep = fx.goalCall = null;
      fx.puckSlideTime = -Infinity;
      fx.lastCannonImpact = -Infinity;
      fx.lastFireHitSound = -Infinity;
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
      for (let i = 0; i < 9; i++) fx.fireworks.push({ x: team === 0 ? 560 + Math.random() * 340 : 100 + Math.random() * 340, y: 560,
        vy: -(430 + Math.random() * 160), fuse: .55 + Math.random() * .3, delay: .1 + i * .17, team, ring: i % 3 === 2 });
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
      if (isReducedMotion()) { clearEffects(); return; }
      const fieldFx = getEffects(), view = getView(), rinkWrap = getRinkWrap();
      for (const trail of fx.trails) {
        for (const point of trail) point.life -= dt;
        while (trail.length && trail[0].life <= 0) trail.shift();
      }
      updateParticles(dt, fx.particles, fx.fireworks, fx.shockwaves, f => {
        gameAudio()?.playFirework?.({
          ring: Boolean(f.ring),
          pan: Math.max(-0.75, Math.min(0.75, ((f.x - 500) / 500) * 0.65)),
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
      if (!view.field && rinkWrap) rinkWrap.style.translate = fieldFx.shake ? `${fieldFx.shakeX}px ${fieldFx.shakeY}px` : '';
      fieldFx.ballFlare = Math.max(0, fieldFx.ballFlare - dt / .8);
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
        if (fx.pings.length < 12) fx.pings.push({ x: px, y: py, life: .4, duration: .4 });
      } else if ((wallType === 'net' || velocity > 220) && fx.ripples.length < 24) {
        const net = wallType === 'net', half = (net ? 26 : 60) / WALL_STEP;
        let best = null;
        for (const run of net ? NET_RUNS : BOARD_RUNS) run.forEach((p, k) => {
          const d = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (!best || d < best.d) best = { d, run, k };
        });
        if (best) {
          fx.ripples.push({ run: best.run, lo: Math.max(0, best.k - half), hi: Math.min(best.run.length - 1, best.k + half),
            net, side: x < 500 ? 0 : 1, amp: Math.min(1, velocity / 500), life: .6, duration: .6 });
        }
      }
    }

    function popup(body, text) {
      const popups = getEffects().popups;
      if (!isReducedMotion() && popups.length < 8) popups.push({ x: body.x, y: body.y - body.radius - 20, text, team: body.team, life: 1.2, duration: 1.2 });
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

    function ribbon(points, widthAt) {
      const ctx = getView().ctx, left = [], right = [];
      points.forEach((p, k) => {
        const a = points[Math.max(0, k - 1)], b = points[Math.min(points.length - 1, k + 1)];
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, half = widthAt(p) / 2;
        left.push([p.x + nx * half, p.y + ny * half]); right.push([p.x - nx * half, p.y - ny * half]);
      });
      ctx.beginPath(); ctx.moveTo(left[0][0], left[0][1]);
      for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath(); ctx.fill();
    }

    function softRibbon(points, widthAt, blur, color) {
      const ctx = getView().ctx, scale = ctx.getTransform().a, offset = 4000;
      ctx.save();
      ctx.shadowColor = color; ctx.shadowBlur = blur * scale; ctx.shadowOffsetX = offset;
      ctx.translate(-offset / scale, 0);
      ribbon(points, widthAt);
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

    function paintIce() {
      const fx = getEffects(), ctx = getView().ctx;
      for (const s of fx.skids) {
        const age = Math.floor(s.age * 4) / 4;
        const t = age / SKID_LIFE, fade = 1 - t * t * (3 - 2 * t), thin = .6 + .4 * fade;
        ctx.globalAlpha = .12 * fade;
        softRibbon(s.points, p => s.width * .7 * (.4 + .6 * p.depth) * thin, s.width * .45, '#000000');
        ctx.globalAlpha = .08 * fade;
        softRibbon(s.points, p => s.width * .3 * p.depth * thin, s.width * .2, '#000000');
      }
      for (const s of fx.burns) {
        if (s.points.length < 2) continue;
        const age = Math.floor(s.age * 4) / 4;
        const t = age / BURN_LIFE, fade = 1 - t * t * (3 - 2 * t);
        ctx.globalAlpha = .3 * fade;
        softRibbon(s.points, p => s.width * (.5 + .5 * p.depth), s.width * .35, '#2b1206');
        ctx.globalAlpha = .22 * fade;
        softRibbon(s.points, p => s.width * .35 * p.depth, s.width * .15, '#000000');
      }
    }

    function drawFieldUnder(colors) {
      const { primary, home, away } = colors, fx = getEffects(), view = getView(), ctx = view.ctx;
      if (fx.kickoffGlow) {
        ctx.save(); ctx.globalAlpha = fx.kickoffGlow; ctx.shadowColor = primary; ctx.shadowBlur = 12 * view.canvas.width / 1000;
        circle(500, 300, 70 + (1 - fx.kickoffGlow) * 10, primary, 3); ctx.restore();
      }
      if (fx.skids.length || fx.burns.length) {
        let key = view.canvas.width + ',' + view.canvas.height;
        for (const s of fx.skids) key += ',' + Math.floor(s.age * 4) + ':' + s.points.length;
        key += '|';
        for (const s of fx.burns) key += ',' + Math.floor(s.age * 4) + ':' + s.points.length;
        cachedLayer(fx.iceCache, key, paintIce, Math.min(1, 1000 / view.canvas.width));
      }
      if (getPhase() === 'plan' && pulseMode() && !P.settled(view.bodies)) {
        inRink(() => { ctx.fillStyle = 'rgba(120,170,255,.07)'; ctx.fillRect(60, 60, 880, 480); });
      }
      fx.danger.forEach((glow, side) => {
        if (glow < .02) return;
        const x = side ? 940 : 60, color = side ? away : home;
        ctx.save(); ctx.globalAlpha = Math.min(1, glow) * .4; ctx.shadowColor = color; ctx.shadowBlur = 8 * glow * view.canvas.width / 1000;
        line(x, 230, x, 370, color, 5); ctx.restore();
      });
    }

    function drawGoalSweep(sweep, color) {
      const view = getView(), ctx = view.ctx;
      const p = sweep.p, x = sweep.team ? 60 + p * 880 : 940 - p * 880;
      inRink(() => {
        ctx.fillStyle = hexToRgba(color, .12 * Math.sin(Math.PI * p)); ctx.fillRect(60, 60, 880, 480);
        const band = ctx.createLinearGradient(x - 220, 0, x + 220, 0);
        band.addColorStop(0, hexToRgba(color, 0)); band.addColorStop(.4, hexToRgba(color, .32));
        band.addColorStop(.5, 'rgba(255,255,255,.5)'); band.addColorStop(.6, hexToRgba(color, .32)); band.addColorStop(1, hexToRgba(color, 0));
        ctx.globalAlpha = 1 - p * .6; ctx.fillStyle = band; ctx.fillRect(60, 60, 880, 480);
      });
      const mouth = sweep.team ? 60 : 940, back = sweep.team ? mouth - P.rink.goalDepth : mouth + P.rink.goalDepth;
      ctx.save(); ctx.globalAlpha = 1 - p; ctx.shadowColor = color; ctx.shadowBlur = 24 * view.canvas.width / 1000;
      line(mouth, 230, back, 230, color, 6); line(back, 230, back, 370, color, 6); line(mouth, 370, back, 370, color, 6);
      line(mouth, 230, mouth, 370, '#ffffff', 3);
      ctx.restore();
    }

    function drawGoalCall(call, color) {
      const view = getView(), badgeCtx = view.badgeCtx, skaters = getSkaters();
      const pop = isReducedMotion() ? 1 : Math.min(1, call.t / .27), scale = 1 + 2.70158 * (pop - 1) ** 3 + 1.70158 * (pop - 1) ** 2;
      const face = skaters[call.scorer]?.querySelector?.('canvas'), top = face ? 40 : 0;
      const write = (text, y, size) => {
        badgeCtx.font = `900 ${size}px system-ui, sans-serif`; badgeCtx.lineWidth = size / 14; badgeCtx.strokeStyle = color;
        badgeCtx.strokeText(text, 0, y); badgeCtx.fillStyle = '#ffffff'; badgeCtx.fillText(text, 0, y);
      };
      badgeCtx.save(); badgeCtx.translate(500, 300); if (view.portrait) badgeCtx.rotate(Math.PI / 2); badgeCtx.scale(scale, scale);
      badgeCtx.globalAlpha = Math.max(0, Math.min(1, (GOAL_CALL_SECONDS - call.t) / .5));
      badgeCtx.shadowColor = color; badgeCtx.shadowBlur = 30 * view.canvas.width / 1000;
      if (face) {
        badgeCtx.beginPath(); badgeCtx.arc(0, -82, 74, 0, Math.PI * 2); badgeCtx.fillStyle = color; badgeCtx.fill();
        badgeCtx.shadowBlur = 0; badgeCtx.drawImage(face, -66, -148, 132, 132);
        badgeCtx.shadowBlur = 30 * view.canvas.width / 1000;
      }
      badgeCtx.textAlign = 'center'; badgeCtx.textBaseline = 'middle';
      const callLabel = view.anonymous && call.scorer < 0 && call.label.endsWith(' WINS!') && ububallReplay?.ANONYMOUS
        ? `${ububallReplay.ANONYMOUS[call.team].toUpperCase()} WINS!`
        : call.label;
      const callName = view.anonymous && call.scorer >= 0 ? anonymousName(call.scorer) : call.name;
      write(callLabel, top, 88);
      if (callName) write(callName, top + 66, 34);
      badgeCtx.restore();
    }

    function drawFieldOver(colors) {
      const { border, text, home, away } = colors, fx = getEffects(), view = getView(), ctx = view.ctx;
      for (const r of fx.ripples) {
        const p = 1 - r.life / r.duration, bulge = r.amp * (r.net ? 9 : 8) * (1 - p) * Math.cos(p * Math.PI * 5);
        ctx.save(); ctx.globalAlpha = (1 - p) * .9; ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let k = r.lo; k <= r.hi; k++) {
          const w = r.run[k], d = bulge * Math.sin(Math.PI * (k - r.lo) / Math.max(1, r.hi - r.lo)) ** 2;
          ctx.lineTo(w.x + w.nx * d, w.y + w.ny * d);
        }
        ctx.strokeStyle = r.net ? (r.side ? away : home) : border; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
      }
      for (const g of fx.pings) {
        const p = 1 - g.life / g.duration;
        ctx.save(); ctx.globalAlpha = 1 - p; circle(g.x, g.y, 4 + p * 16, text, 2);
        ctx.fillStyle = text; ctx.beginPath(); ctx.arc(g.x, g.y, 3 * (1 - p) + 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
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

    function paintPrediction(prediction, home, away) {
      const view = getView(), ctx = view.ctx;
      prediction.paths.forEach((points, index) => {
        if (points.length < 2) return;
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
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i <= solidEnd; i++) ctx.lineTo(points[i].x, points[i].y);
          ctx.stroke();
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
            ctx.beginPath();
            ctx.moveTo(points[start].x, points[start].y);
            for (let i = start + 1; i <= end; i++) ctx.lineTo(points[i].x, points[i].y);
            ctx.stroke();
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

    function drawPrediction(home, away) {
      const view = getView(), key = predictionKey();
      if (predictionCache?.key !== key) {
        const data = P.predictTurn(view.bodies, getPlans());
        predictionCache = { key, data, fouls: predictFouls(data) };
      }
      cachedLayer(predictionLayer, [view.canvas.width, view.canvas.height, home, away, view.portrait, view.mode, key].join(), () => paintPrediction(predictionCache.data, home, away));
    }

    function drawPredictedGoalGlow(home, away) {
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
      ctx.shadowBlur = blur;
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

    function drawSpin(b, color) {
      const spin = Math.abs(b.omega);
      if (spin < 2.5 || isReducedMotion()) return;
      const ctx = getView().ctx;
      const power = Math.min(1, (spin - 2.5) / 20), arcs = spin >= 8 ? 3 : 2;
      const dir = Math.sign(b.omega), sweep = (.92 + 1.22 * power) * dir;
      const taperedArc = (radius, startAngle, arcSweep, maxWidth, peakAlpha) => {
        const steps = 10, endAngle = startAngle + arcSweep;
        const outer = [], inner = [];
        for (let s = 0; s <= steps; s++) {
          const u = s / steps;
          const ang = startAngle + arcSweep * u;
          const profile = Math.pow(u, 1.35) * (u > 0.86 ? 1 - 0.22 * ((u - 0.86) / 0.14) : 1);
          const half = maxWidth * 0.5 * profile;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          outer.push([b.x + ca * (radius + half), b.y + sa * (radius + half)]);
          inner.push([b.x + ca * (radius - half), b.y + sa * (radius - half)]);
        }
        const tipAng = endAngle + dir * Math.min(0.16, (maxWidth * 1.15) / Math.max(12, radius));
        const tipX = b.x + Math.cos(tipAng) * radius, tipY = b.y + Math.sin(tipAng) * radius;
        const tailX = outer[0][0], tailY = outer[0][1];
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        for (let s = 1; s <= steps; s++) ctx.lineTo(outer[s][0], outer[s][1]);
        ctx.lineTo(tipX, tipY);
        for (let s = steps; s >= 1; s--) ctx.lineTo(inner[s][0], inner[s][1]);
        ctx.closePath();
        if (Math.hypot(tipX - tailX, tipY - tailY) > 0.5) {
          const grad = ctx.createLinearGradient(tailX, tailY, tipX, tipY);
          grad.addColorStop(0, hexToRgba(color, 0));
          grad.addColorStop(0.35, hexToRgba(color, peakAlpha * 0.3));
          grad.addColorStop(0.8, hexToRgba(color, peakAlpha * 0.85));
          grad.addColorStop(1, hexToRgba(color, peakAlpha));
          ctx.fillStyle = grad;
        } else {
          ctx.fillStyle = hexToRgba(color, peakAlpha);
        }
        ctx.fill();
      };
      ctx.save();
      for (let k = 0; k < arcs; k++) {
        const start = b.rotation + k * 2 * Math.PI / arcs;
        taperedArc(b.radius + 4.5, start, sweep, 1.8 + 3.0 * power, Math.min(0.95, 0.28 + 0.62 * power));
        if (power > 0.45) {
          taperedArc(b.radius + 10.5, start + sweep * 0.32, sweep * 0.68, 1.1 + 1.3 * power, Math.min(0.65, (power - 0.45) * 1.05));
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
        if (before[i] && (before[i].x !== b.x || before[i].y !== b.y)) trails[i].length = 0;
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
      ctx.shadowBlur = isReducedMotion() ? 0 : 8 * view.canvas.width / 1000;
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
      const view = getView(), fx = getEffects();
      const c = overlay ? view.badgeCtx : view.ctx;
      c.save(); c.lineCap = 'round';
      const flameDots = [];
      for (const p of fx.particles) {
        if (Boolean(p.overlay) !== overlay) continue;
        const color = p.color || (p.team === -1 ? '#ffffff' : p.team === 0 ? home : away), fade = p.life / p.duration;
        c.globalAlpha = Math.min(1, fade * 2) * (p.celebration || p.snap ? .95 : .65);
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
        if (p.celebration) c.drawImage(glowSprite(color, doc), p.x - 24, p.y - 24, 48, 48);
        const px = p.px === p.x && p.py === p.y ? p.x - 0.01 : p.px;
        c.beginPath(); c.moveTo(px, p.py); c.lineTo(p.x, p.y); c.strokeStyle = color; c.lineWidth = p.celebration || p.snap ? 2.6 : 1.3; c.stroke();
        c.fillStyle = color; c.beginPath(); c.arc(p.x, p.y, p.celebration || p.snap ? 1.9 : .9, 0, Math.PI * 2); c.fill();
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

    function handleCollision(a, b, speed, impulse, plow = false, iron = false, snapped = false, tangentImpulse = 0) {
      if (iron) {
        if (a?.guarding) a.ironGuard = true;
        if (b?.guarding) b.ironGuard = true;
      }
      const isBall = a.team === -1 || b.team === -1;
      const isSnap = isBall && Boolean(snapped || a?.snapStruck || b?.snapStruck);
      const isSpinStrike = isBall && Boolean(a?.spinStruck || b?.spinStruck);
      const spinBoost = !isBall && a.team !== b.team ? (tangentImpulse || 0) * 0.45 : 0;
      const effSpeed = Math.max(speed, spinBoost);
      if (effSpeed < 15 && !isSnap && !isSpinStrike) return;
      const fx = getEffects();
      const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const x = a.x + (b.x - a.x) * a.radius / distance, y = a.y + (b.y - a.y) * a.radius / distance;
      const tangent = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
      const sparkStrength = Math.min(1.35, effSpeed / 600);
      burst(x, y, a.team, sparkStrength, false, tangent);
      if (a.team !== b.team) burst(x, y, b.team, sparkStrength, false, tangent);
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
      if (plow) flames(x, y, 40, (b.vx || a.vx) * 0.1, (b.vy || a.vy) * 0.1, 15);
      const now = clockNow();
      if (!plow && speed >= 15) contactMeter?.(a, b, speed);
      if (isBall) {
        const ball = a.team === -1 ? a : b;
        const player = a.team !== -1 ? a : b;
        const norm = Math.min(1.0, Math.max(0.0, (speed - 25) / 550));
        const volume = Math.min(1.0, 0.15 + 0.85 * (norm ** 0.8));
        if (isSpinStrike && gameAudio()?.playSpinStrike) {
          const sMap = (fx.spinStrikeTimes ||= new WeakMap());
          if (now - (sMap.get(ball) ?? -Infinity) > 50) {
            sMap.set(ball, now);
            gameAudio().playSpinStrike({ volume: Math.min(1.0, 0.45 + 0.55 * (norm ** 0.8)), spin: ball.omega || player.omega || 14 });
          }
        }
        const fireHit = !iron && (plow || P.ballOnFire?.(ball)) && (now - (fx.lastCannonImpact ?? -Infinity) > 20);
        if (fireHit && gameAudio()?.playFireImpact && (now - (fx.lastFireHitSound ?? -Infinity) > 55)) {
          fx.lastFireHitSound = now;
          gameAudio().playFireImpact({ volume: Math.min(1.0, 0.42 + 0.58 * (norm ** 0.8)) });
        }
        if (isSnap || isSpinStrike || !player._lastHitSound || (now - player._lastHitSound) > 55) {
          player._lastHitSound = now;
          if (player.voice && gameAudio()) {
            gameAudio().playCollision(player.voice, { volume });
          }
          if (gameAudio()) {
            gameAudio().playBallHit({ volume: isSnap ? Math.min(1.0, volume * 1.15) : volume, snap: isSnap });
          }
        }
      } else if (a.team !== -1 && b.team !== -1) {
        const norm = Math.min(1.0, Math.max(0.0, (effSpeed - 40) / 600));
        const volume = Math.min(1.0, 0.12 + 0.75 * (norm ** 0.8));
        const primary = (Math.hypot(a.vx, a.vy) * a.mass >= Math.hypot(b.vx, b.vy) * b.mass) ? a : b;
        if (primary.voice && gameAudio()) {
          if (!primary._lastHitSound || (now - primary._lastHitSound) > 65) {
            primary._lastHitSound = now;
            gameAudio().playCollision(primary.voice, { volume });
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
        if (!isReducedMotion()) {
          const idx = view.bodies?.indexOf(body) ?? -1;
          if (idx >= 0 && idx < 6) {
            const s = fx.skidState[idx] ||= { time: 0 };
            Object.assign(s, { time: Math.max(s.time || 0, .22), strength: Math.max(s.time > 0 ? s.strength : 0, .55) });
          }
          for (let k = 0; k < 5 && fx.particles.length < 400; k++) {
            const ang = tangent + (k % 2 ? Math.PI : 0) + (Math.random() - .5) * .45;
            const spd = 45 + Math.random() * 85, life = .14 + Math.random() * .12;
            fx.particles.push({ x: cx, y: cy, px: cx, py: cy,
              vx: Math.cos(ang) * spd - nx * 25, vy: Math.sin(ang) * spd - ny * 25,
              team: -1, color: k % 2 ? '#e8f7ff' : '#ffffff', life, duration: life });
          }
        }
        const map = (fx.carveTimes ||= new WeakMap());
        if (now - (map.get(body) ?? -Infinity) >= 180) {
          map.set(body, now);
          const speed = Math.hypot(body.vx || 0, body.vy || 0);
          gameAudio()?.playCarve?.({ volume: Math.min(0.55, 0.16 + 0.36 * Math.min(1, speed / 550)) });
        }
        return;
      }
      if (body._lastWallSound && (now - body._lastWallSound) < 60) return;
      body._lastWallSound = now;
      burst(cx, cy, body.team, Math.min(1, velocity / 500), false, tangent);
      if (wallType === 'post' && body.team === -1 && velocity >= 240 && !isReducedMotion()) {
        for (let k = 0; k < 8 && fx.particles.length < 400; k++) {
          const ang = tangent + (k % 2 ? Math.PI : 0) + (Math.random() - .5) * .4;
          const spd = 80 + Math.random() * 140, life = .16 + Math.random() * .14;
          fx.particles.push({ x: cx, y: cy, px: cx, py: cy,
            vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
            team: -1, color: k % 2 ? '#ffd76b' : '#ffffff', life, duration: life });
        }
      }
      const norm = Math.min(1.0, Math.max(0.0, (velocity - 20) / 480));
      const volume = Math.min(1.0, 0.15 + 0.85 * (norm ** 0.8));
      const audio = gameAudio();
      if (!audio) return;
      if (body.team === -1 && P.ballOnFire?.(body) && velocity >= 90 && (now - (fx.lastFireHitSound ?? -Infinity) > 55)) {
        fx.lastFireHitSound = now;
        audio.playFireImpact?.({ volume: Math.min(0.9, 0.32 + 0.55 * (norm ** 0.85)) });
      }
      if (wallType === 'post') {
        audio.playGoalHit('post', { volume: Math.min(1.0, volume * 1.1), spin: Math.abs(body.omega || 0), speed: velocity });
      } else if (wallType === 'net') {
        audio.playGoalHit('net', { volume });
      } else {
        audio.playWallHit({ volume: Math.min(0.85, 0.1 + 0.68 * (norm ** 1.05)) });
      }
    }

    function handleSuper(key, stage, body, target = null) {
      const fx = getEffects();
      if (key === 'cannonball' && stage === 'impact') fx.lastCannonImpact = clockNow();
      if (key === 'stalwart' && stage === 'impact') {
        const now = clockNow();
        if (now - (fx.superImpactTimes.get(body) ?? -Infinity) < 100) return;
        fx.superImpactTimes.set(body, now);
      }
      if (stage === 'impact' && target && !isReducedMotion()) {
        const dx = target.x - body.x, dy = target.y - body.y;
        const distance = Math.hypot(dx, dy) || 1;
        const reach = target.team === -1 ? Math.max(body.radius, body.reach || body.radius, 18) : body.radius;
        const x = body.x + dx / distance * reach, y = body.y + dy / distance * reach;
        const tangent = Math.atan2(dy, dx) + Math.PI / 2;
        if (key === 'knockout') {
          burst(x, y, target.team, 3, false, tangent, '#ee2b47');
        } else if (key === 'cannonball' || key === 'stalwart') {
          const color = key === 'cannonball' ? '#ff634d' : '#ffd166';
          if (key === 'cannonball') fx.ballFlare = 1;
          burst(x, y, body.team, 3.5, false, tangent, color);
          if (fx.shockwaves.length < 32) fx.shockwaves.push({ x, y, currentRadius: 4,
            maxRadius: key === 'cannonball' ? 48 : 36, team: body.team, color, life: .24, duration: .24 });
        }
      }
      gameAudio()?.playSuper?.(key, stage);
    }

    function handleShockwave(source, radius, type = null) {
      const fx = getEffects();
      if (type === 'iron') {
        burst(source.x, source.y, source.team, 0.7, false, 0, '#ffffff');
        burst(source.x, source.y, source.team, 0.7, false, 0, '#d2f2ff');
        fx.shockwaves.push({ x: source.x, y: source.y, currentRadius: 8, maxRadius: radius, team: source.team, color: '#e3faff', life: 0.25, duration: 0.25 });
        return;
      }
      burst(source.x, source.y, source.team, 1, false, 0, '#ff7197');
      burst(source.x, source.y, source.team, 1, false, 0, '#9d467a');
      fx.shockwaves.push({ x: source.x, y: source.y, currentRadius: 10, maxRadius: radius, team: source.team, color: '#ff7197', life: 0.35, duration: 0.35 });
      fx.shockwaves.push({ x: source.x, y: source.y, currentRadius: 6, maxRadius: radius * 0.88, team: source.team, color: '#9d467a', life: 0.30, duration: 0.30 });
      if (gameAudio()) {
        gameAudio().playSuper?.('shockwave', 'impact', { volume: 0.8 });
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
      const dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1;
      const rawW = sizes.deviceWidth || Math.round(renderWidth * dpr);
      const rawH = sizes.deviceHeight || Math.round(renderHeight * dpr);
      const cap = Math.min(1, 3840 / Math.max(1, rawW, rawH));
      const width = view.field?.width ?? Math.max(1, Math.round(rawW * cap));
      const height = view.field?.height ?? Math.max(1, Math.round(rawH * cap));
      if (view.canvas.width !== width || view.canvas.height !== height) { view.canvas.width = width; view.canvas.height = height; }
      if (view.badgeCanvas.width !== width || view.badgeCanvas.height !== height) { view.badgeCanvas.width = width; view.badgeCanvas.height = height; }
      view.badgeCtx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); view.badgeCtx.clearRect(0, 0, 1000, 600);
      view.ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); view.ctx.clearRect(0, 0, 1000, 600);

      const colors = getThemeColors();
      const { text, home, away, background } = colors;
      fx.rinkCache = drawRinkLayer(view.ctx, width, height, P, ububallMatch, colors, rinkLogo, fx.rinkCache, doc);
      drawFieldUnder(colors);
      if (!view.field) drawFoulFocus(text);
      if (phase === 'plan') {
        drawPrediction(home, away);
        drawPredictedGoalGlow(home, away);
      }
      drawTrails(view.ctx, fx.trails, view.bodies, home, away, ballHeat);
      drawGuides(home, away, text, playback ? playback.guide : getGuide());
      fx.shockwaves.forEach(s => {
        const progress = 1 - Math.max(0, s.life / s.duration);
        const r = s.currentRadius + (s.maxRadius - s.currentRadius) * progress;
        const targetCtx = s.overlay && view.badgeCtx ? view.badgeCtx : view.ctx;
        targetCtx.save();
        targetCtx.beginPath();
        targetCtx.arc(s.x, s.y, r, 0, Math.PI * 2);
        targetCtx.strokeStyle = s.color || (s.team === 0 ? home : away);
        targetCtx.lineWidth = Math.max(1, (s.overlay ? 4.5 : 6) * (1 - progress));
        targetCtx.globalAlpha = Math.max(0, (1 - progress) * (s.overlay ? 0.92 : 1));
        targetCtx.stroke();
        targetCtx.restore();
      });

      const scoringPlayer = getScoringPlayer();
      const goalReplay = getGoalReplay();
      const onlineReplay = getOnlineReplay();
      const skaters = getSkaters();

      view.bodies.slice(0, 6).forEach((b, i) => {
        const reachR = Math.max(b.radius, b.reach || b.radius, 18);
        const isSuperReady = (b.meter >= 100) || Boolean(b.superArm) || Boolean(b.superActive);

        if (isSuperReady) {
          const activeKey = b.superActive || b.equippedSuper?.key || 'stalwart';
          drawSuperAura(b, activeKey, reachR);
          if (phase === 'plan' && b.superArm && activeKey === 'colossus') {
            view.ctx.save();
            view.ctx.setLineDash([5, 5]);
            circle(b.x, b.y, Math.min(60, b.radius * (P.SUPER?.colossusRadius || 1.8)), '#ffe043cc', 2);
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
          if (dx * dx + dy * dy < 260 * 260) {
            view.ctx.save();
            view.ctx.setLineDash([4, 6]);
            line(b.x, b.y, ball.x, ball.y, '#3388ffcc', 2.5);
            view.ctx.restore();
          }
        }
        if (i < 3 && phase === 'plan') drawImpulse(b, fieldPlans[i], home);
        if (view.field || !skaters[i]) return;
        const style = skaters[i].style;
        const wPct = b.radius / 5 + '%';
        const opacity = b.carded ? '0.3' : b.superActive === 'ghost' ? '0.45' : '1';
        const filter = (b.stunned || b.stunnedNext) && !b.carded ? 'grayscale(0.8) brightness(0.7)' : '';
        const transform = `translate(${b.x / 1000 * renderWidth}px, ${b.y / 600 * renderHeight}px) translate(-50%, -50%) rotate(${b.rotation + (view.portrait ? Math.PI / 2 : 0)}rad)`;

        if (style.width !== wPct) style.width = wPct;
        if (style.opacity !== opacity) style.opacity = opacity;
        if (style.filter !== filter) style.filter = filter;
        if (style.transform !== transform) style.transform = transform;
      });

      const holding = P.holder?.(view.bodies);
      if (holding && view.bodies[6]) drawStickyTether(holding, view.bodies[6]);

      if (phase === 'plan') {
        const b = view.bodies[getSelected()];
        if (b) circle(b.x, b.y, b.radius + 8, text, 2);
      }

      const ball = view.bodies[6];
      if (ball) {
        view.ctx.beginPath(); view.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); view.ctx.fillStyle = background; view.ctx.fill();
        circle(ball.x, ball.y, ball.radius, text, 2);
        const heat = ballHeat(ball), glow = Math.max(0, heat - 1) / 2;
        if (glow > 0) {
          view.ctx.save(); view.ctx.globalAlpha = .75 * glow; view.ctx.shadowColor = heatColor(heat); view.ctx.shadowBlur = 16 * glow * view.canvas.width / 1000;
          view.ctx.beginPath(); view.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); view.ctx.fillStyle = heatColor(heat); view.ctx.fill(); view.ctx.restore();
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
        view.bodies.slice(0, 6).forEach(b => { if (!b.carded) drawSpin(b, b.team ? away : home); });
        drawSpin(ball, text);
      }

      drawParticles(home, away);
      drawFieldOver(colors);
      drawFouls(text, playback?.viewFouls ?? getFouls());
      drawPopups(view.badgeCtx, fx.popups, view.portrait, width, home, away);
      drawParticles(home, away, true);

      if (goalReplay) {
        view.ctx.save(); view.ctx.translate(view.portrait ? 30 : 500, view.portrait ? 300 : 32); if (view.portrait) view.ctx.rotate(Math.PI / 2);
        view.ctx.font = 'bold 18px system-ui'; view.ctx.textAlign = 'center'; view.ctx.textBaseline = 'middle'; view.ctx.fillStyle = text;
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
    drawRinkLayer,
    createRinkPresenter
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ububallPresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
