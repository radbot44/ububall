'use strict';
// Painted 2D foil, cellophane and candy. No 3D engine or geometry.
(() => {
  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = (a, b, t) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
  const mix = (a, b, t) => a + (b - a) * t;
  function createPackScene(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    let frame = 0, progress = 0, started = 0, finish = null, count = 5, pointer = 0;
    let color, candyColors, creases, previousColor = -1;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const logo = new Image(), mark = new Image();
    logo.onload = mark.onload = requestPaint;
    logo.src = 'uburoom-wordmark-brand.svg'; mark.src = 'uburoom-oomark-brand.svg';
    function paletteColor(index) {
      // Reuse the decoder's frozen palette without maintaining a second copy.
      const dna = new Uint8Array(32); dna[8] = index << 3;
      return ubu.decode(dna).attributes.background.hex;
    }
    function tint(hex, amount) {
      const target = amount < 0 ? 0 : 255;
      return '#' + [1, 3, 5].map(i => Math.round(mix(parseInt(hex.slice(i, i + 2), 16), target, Math.abs(amount))).toString(16).padStart(2, '0')).join('');
    }
    function recolor() {
      let index;
      do { index = crypto.getRandomValues(new Uint8Array(1))[0] & 31; } while (index === previousColor);
      previousColor = index; color = paletteColor(index); canvas.dataset.color = String(index);
      candyColors = Array.from({ length: 5 }, (_, i) => paletteColor((index + i * 7) & 31));
      const rolls = crypto.getRandomValues(new Uint16Array(150));
      creases = Array.from({ length: 30 }, (_, i) => {
        const r = j => rolls[i * 5 + j] / 65535;
        return { x: r(0) * 220 - 110, y: r(1) * 270 - 135, dx: r(2) * 65 - 32, dy: r(3) * 85 + 15, strength: .08 + r(4) * .25 };
      });
      requestPaint();
    }
    function gradient(x1, y1, x2, y2, stops) {
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      for (const [at, value] of stops) g.addColorStop(at, value);
      return g;
    }
    function silhouette(flat) {
      const y = (closed, opened) => mix(closed, opened, flat);
      ctx.beginPath(); ctx.moveTo(-240, y(-88, -135));
      ctx.bezierCurveTo(-196, y(-76,-135), -146, y(-17,-135), -110, y(-12,-135));
      ctx.bezierCurveTo(-108, y(-76,-135), -61, y(-112,-135), 0, y(-112,-135));
      ctx.bezierCurveTo(61, y(-112,-135), 108, y(-76,-135), 110, y(-12,-135));
      ctx.bezierCurveTo(146, y(-17,-135), 196, y(-76,-135), 240, y(-88,-135));
      ctx.lineTo(240, y(88,135));
      ctx.bezierCurveTo(196, y(76,135), 146, y(17,135), 110, y(12,135));
      ctx.bezierCurveTo(108, y(76,135), 61, y(112,135), 0, y(112,135));
      ctx.bezierCurveTo(-61, y(112,135), -108, y(76,135), -110, y(12,135));
      ctx.bezierCurveTo(-146, y(17,135), -196, y(76,135), -240, y(88,135));
      ctx.closePath();
    }
    function film(flat, untwist) {
      ctx.fillStyle = gradient(-240,-90,240,90, [[0,'#e9f1ff25'],[.25,'#d5e3ff10'],[.5,'#ffffff05'],[.8,'#e9f1ff18'],[1,'#e9f1ff36']]);
      ctx.fillRect(-240,-135,480,270);
      for (const side of [-1, 1]) {
        ctx.save(); ctx.scale(side, 1);
        for (let i = -6; i <= 6; i++) {
          const inner = mix(i * 1.8, i * 22, flat), outer = i * mix(17,22,flat);
          const curl = Math.sin(i * .8 + untwist * 2.8) * 21 * (1 - untwist);
          ctx.beginPath(); ctx.moveTo(110,inner);
          const ripple = Math.sin(i*2.3)*6;
          ctx.bezierCurveTo(146,inner+curl,167,outer-12*(1-flat),190,outer+5+ripple);
          ctx.bezierCurveTo(210,outer-5,225,outer+3-ripple,240,outer);
          ctx.strokeStyle = gradient(110,0,240,0,[[0,'#ffffff18'],[.45,'#e3f0ff85'],[.65,'#ffffff20'],[1,'#ffffff65']]);
          ctx.lineWidth = i % 3 === 0 ? 2 : .8; ctx.stroke();
          ctx.translate(0,2); ctx.strokeStyle = '#050b1430'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.translate(0,-2);
        }
        // Broad reflections give the clear areas a continuous film surface.
        ctx.fillStyle = gradient(110,0,240,20,[[0,'#ffffff00'],[.4,'#ffffff00'],[.48,'#ffffff24'],[.52,'#ffffff06'],[.8,'#ffffff00'],[.98,'#ffffff30']]);
        ctx.fillRect(110,-135,130,270); ctx.restore();
      }
    }
    function foil(flat, untwist) {
      ctx.save(); ctx.beginPath(); ctx.rect(-110,-135,220,270); ctx.clip();
      ctx.fillStyle = color; ctx.fillRect(-110,-135,220,270);
      // Painted curvature relaxes as the same sheet opens; its printed area never scales.
      const round = ctx.createRadialGradient(-35+pointer*12,-45,5,6,15,130);
      round.addColorStop(0,'#ffffff70'); round.addColorStop(.35,'#ffffff14'); round.addColorStop(.65,'#00000000'); round.addColorStop(.85,'#00000040'); round.addColorStop(1,'#000000b0');
      ctx.globalAlpha *= 1-flat*.75; ctx.fillStyle = round; ctx.fillRect(-110,-135,220,270);
      ctx.globalAlpha /= 1-flat*.75;
      for (const c of creases) {
        ctx.beginPath(); ctx.moveTo(c.x-5,c.y);
        ctx.lineTo(c.x+c.dx*.55,c.y+c.dy*.38); ctx.lineTo(c.x+c.dx,c.y+c.dy);
        ctx.lineTo(c.x+c.dx*.55+8,c.y+c.dy*.38); ctx.closePath();
        ctx.fillStyle = gradient(c.x-7,0,c.x+12,0,[[0,'#00000000'],[.4,`rgba(0,0,0,${c.strength*.6})`],[.52,`rgba(255,255,255,${c.strength})`],[1,'#ffffff00']]);
        ctx.fill();
        ctx.beginPath(); ctx.moveTo(c.x,c.y);
        ctx.lineTo(c.x+c.dx*.55,c.y+c.dy*.38); ctx.lineTo(c.x+c.dx,c.y+c.dy);
        ctx.strokeStyle = `rgba(0,0,0,${c.strength*.6})`; ctx.lineWidth = 2.4; ctx.stroke();
        ctx.translate(-.8,-.6); ctx.strokeStyle = `rgba(255,255,255,${c.strength})`; ctx.lineWidth = .8; ctx.stroke(); ctx.translate(.8,.6);
      }
      const shineX = -70 + pointer*22 + untwist*85;
      ctx.fillStyle = gradient(shineX-55,-135,shineX+100,135,[[0,'#ffffff00'],[.31,'#ffffff00'],[.4,'#ffffff50'],[.43,'#ffffffa0'],[.46,'#ffffff12'],[.57,'#ffffff00'],[.8,'#ffffff22'],[1,'#ffffff00']]);
      ctx.fillRect(-110,-135,220,270);
      // Fixed-size printed logo, with a dark ink bed for all 32 wrapper colors.
      ctx.fillStyle = '#101217bb'; ctx.beginPath(); ctx.roundRect(-94,-32,188,64,6); ctx.fill();
      if (logo.complete && logo.naturalWidth) ctx.drawImage(logo,-88,-27,176,55);
      ctx.restore();
    }
    function wrapper(t) {
      const untwist = ease(0,.34,t), flat = ease(.25,.61,t), peel = ease(.6,.9,t);
      ctx.save(); ctx.globalAlpha = 1-ease(.82,.94,t);
      ctx.translate(peel*12,peel*185); ctx.rotate(mix(-.09,0,untwist)+peel*.12);
      silhouette(flat); ctx.save(); ctx.clip();
      film(flat,untwist); foil(flat,untwist); ctx.restore();
      silhouette(flat); ctx.strokeStyle = '#e9f1ff40'; ctx.lineWidth = .8; ctx.stroke();
      ctx.restore();
    }
    function candy(x, y, hex, angle) {
      ctx.save(); ctx.translate(x,y); ctx.rotate(angle);
      ctx.shadowColor = '#0007'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 8;
      ctx.beginPath(); ctx.arc(5,6,70,0,Math.PI*2); ctx.fillStyle = tint(hex,-.5); ctx.fill();
      ctx.shadowColor = 'transparent';
      const gloss = ctx.createRadialGradient(-28,-35,2,4,8,92);
      gloss.addColorStop(0,tint(hex,.55)); gloss.addColorStop(.3,tint(hex,.15)); gloss.addColorStop(.62,hex); gloss.addColorStop(1,tint(hex,-.6));
      ctx.beginPath(); ctx.arc(0,0,70,0,Math.PI*2); ctx.fillStyle = gloss; ctx.fill();
      ctx.strokeStyle = '#ffffff35'; ctx.lineWidth = 1; ctx.stroke();
      if (mark.complete && mark.naturalWidth) ctx.drawImage(mark,-46,-46,92,92);
      ctx.beginPath(); ctx.ellipse(-24,-44,24,8,-.5,0,Math.PI*2);
      ctx.fillStyle = '#ffffff48'; ctx.fill();
      ctx.restore();
    }
    function paint(now) {
      frame = 0;
      if (finish) progress = clamp((now-started)/3600);
      const dpr = Math.min(devicePixelRatio,2), width = Math.round(canvas.clientWidth*dpr), height = Math.round(canvas.clientHeight*dpr);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.resetTransform(); ctx.clearRect(0,0,width,height);
      const scale = width/600; ctx.setTransform(scale,0,0,scale,width/2,height*.46);
      const fan = ease(.54,.84,progress);
      if (fan) {
        ctx.save(); ctx.globalAlpha = ease(.54,.64,progress)*(1-ease(.96,1,progress));
        const order = Array.from({ length: count }, (_,i) => i).sort((a,b) => Math.abs(b-(count-1)/2)-Math.abs(a-(count-1)/2));
        for (const i of order) {
          const slot = i-(count-1)/2;
          candy(slot*82*fan,-28*fan+Math.abs(slot)*14*fan,candyColors[i%5],slot*.11*fan);
        }
        ctx.restore();
      }
      if (progress < .94) wrapper(progress);
      if (finish) {
        if (progress < 1) requestPaint();
        else { const done = finish; finish = null; done(); }
      }
    }
    function requestPaint() { if (!frame) frame = requestAnimationFrame(paint); }
    canvas.parentElement.addEventListener('pointermove', event => {
      if (reduced.matches || event.pointerType === 'touch' || finish) return;
      const r = canvas.getBoundingClientRect(); pointer = clamp((event.clientX-r.left)/r.width)*2-1; requestPaint();
    });
    canvas.parentElement.addEventListener('pointerleave', () => { pointer=0; requestPaint(); });
    new ResizeObserver(requestPaint).observe(canvas);
    reduced.addEventListener('change', () => { pointer=0; if (reduced.matches && finish) started=performance.now()-3600; requestPaint(); });
    recolor();
    return {
      play(amount=5) {
        count=amount; pointer=0;
        if (reduced.matches) return Promise.resolve();
        started=performance.now(); progress=0;
        return new Promise(resolve => { finish=resolve; requestPaint(); });
      },
      reset(newColor=false) { progress=0; count=5; if (newColor) recolor(); else requestPaint(); }
    };
  }
  globalThis.createPackScene = createPackScene;
})();
