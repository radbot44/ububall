/* Rink presentation state and particle motion shared by live play and video export. */
(function (root) {
  'use strict';
  function createEffectsState(entries, stylesMap) {
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
      materialEmitters: (entries || []).map(entry => {
        const seen = new Set(), styles = [];
        for (const attribute of Object.values(entry?.model?.attributes || {})) {
          const style = stylesMap[attribute.texture];
          if (!style || seen.has(attribute.texture)) continue;
          seen.add(attribute.texture);
          styles.push({ shape: style[0], color: style[1] || attribute.hex });
        }
        return { styles, time: 0 };
      }),
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
  function updateParticles(dt, particles, fireworks, shockwaves) {
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
  const api = { createEffectsState, updateParticles };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ububallPresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
