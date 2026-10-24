'use strict';
// Painted 2D foil, cellophane and candy. No 3D engine or geometry.
(() => {
  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = (a, b, t) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
  const mix = (a, b, t) => a + (b - a) * t;
  function createPackScene(canvas) {
    let ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sheet = document.createElement('canvas');
    sheet.width = 1200; sheet.height = 720;
    const sheetCtx = sheet.getContext('2d');
    let frame = 0, progress = 0, started = 0, finish = null, count = 5, pointer = 0;
    let color, candyColors, creases, previousColor = -1;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const logo = new Image(), mark = new Image();
    logo.onload = mark.onload = requestPaint;
    logo.src = 'uburoom-wordmark-brand.svg'; mark.src = 'uburoom-oomark-brand.svg';
    function paletteColor(index) {
      // Reuse the decoder's frozen palette without maintaining a second copy.
      const dna = new Uint8Array(64); dna[8] = index << 3;
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
    function film(side, flat, untwist) {
      // Start wound up and turn in one direction until the gathered knot releases.
      const phase = side*(1-untwist)*(Math.PI*2+.35);
      const flip = Math.cos(phase), swing = Math.sin(phase);
      const ribs = [];
      // A full D-shaped tail opens into a sheet only after the spin.
      // The whole tail flips together; its separate knot covers the attachment.
      for (let j = 0; j <= 12; j++) {
        const v = j/6-1, rib = [];
        for (let k = 0; k <= 8; k++) {
          const u = k/8;
          const closedX = 110+u*(36+104*Math.sqrt(Math.max(0,1-v*v)));
          const closedY = mix(v*12,v*88,ease(0,1,u));
          const crinkle = (Math.sin(k*1.7+j*2.3+side)*3
            + Math.sin(k*.9-j*1.8)*1.4)*u*(1-flat*.55);
          rib.push({
            x: mix(closedX,110+u*158,flat)+u*v*swing*10
              + Math.sin(j*2.7+k*.7)*u*2,
            y: (mix(closedY,v*135,flat)+crinkle)*flip
              + swing*u*(9+Math.sin(j*1.9+side)*6)
          });
        }
        ribs.push(rib);
      }
      ctx.save(); ctx.scale(side,1);
      for (let j = 0; j < 12; j++) {
        const upper = ribs[j], lower = ribs[j+1];
        const glint = Math.abs(Math.sin(j*.7+phase*.7))*(1-flat*.25);
        ctx.beginPath(); ctx.moveTo(upper[0].x,upper[0].y);
        for (let k = 1; k <= 8; k++) ctx.lineTo(upper[k].x,upper[k].y);
        for (let k = 8; k >= 0; k--) ctx.lineTo(lower[k].x,lower[k].y);
        ctx.closePath();
        ctx.fillStyle = `rgba(184,208,239,${.09+glint*.09})`; ctx.fill();
        // A light and dark side of each fold stay attached to the material.
        for (let k = 0; k < 8; k++) {
          const a = upper[k], b = upper[k+1], c = lower[k+1], d = lower[k];
          ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
          ctx.lineTo(c.x,c.y); ctx.lineTo(d.x,d.y); ctx.closePath();
          const light = Math.abs(Math.sin((j*.65+k*.9)+phase));
          ctx.fillStyle = `rgba(226,240,255,${.015+light*.09})`; ctx.fill();
        }
        ctx.beginPath(); ctx.moveTo(upper[0].x,upper[0].y);
        ctx.lineTo(upper[8].x,upper[8].y);
        ctx.lineTo(lower[8].x,lower[8].y);
        ctx.lineTo(lower[0].x,lower[0].y); ctx.closePath();
        ctx.fillStyle = `rgba(238,246,255,${.06+glint*.25})`; ctx.fill();
        const k = 3+j%4;
        const creaseY = mix(upper[k+1].y,lower[k+1].y,.7);
        ctx.beginPath(); ctx.moveTo(upper[k].x,upper[k].y);
        ctx.lineTo(upper[k+1].x,creaseY);
        ctx.lineTo(upper[k+2].x,upper[k+2].y);
        ctx.strokeStyle = flip < 0 ? '#eff6ff38' : '#07101c50';
        ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(upper[0].x,upper[0].y);
        for (let k = 1; k <= 8; k++) ctx.lineTo(upper[k].x,upper[k].y);
        ctx.strokeStyle = flip < 0 ? '#eff6ff65' : '#06122445';
        ctx.lineWidth = j % 3 === 0 ? 1.3 : .65; ctx.stroke();
      }
      // Trace the free edge so the full D silhouette stays visible.
      ctx.beginPath(); ctx.moveTo(ribs[0][8].x,ribs[0][8].y);
      for (let j = 1; j <= 12; j++) ctx.lineTo(ribs[j][8].x,ribs[j][8].y);
      ctx.strokeStyle = '#e9f1ff55'; ctx.lineWidth = .9; ctx.stroke();
      ctx.restore();
    }
    function knot(side, untwist) {
      const release = ease(.45,1,untwist);
      if (release === 1) return;
      ctx.save(); ctx.scale(side,1);
      ctx.globalAlpha *= 1-release;
      ctx.translate(118+release*7,0);
      // A persistent gathered collar, rather than a pinch created by the spin.
      ctx.beginPath(); ctx.moveTo(-13,-13);
      ctx.bezierCurveTo(-3,-22,11,-19,17,-10);
      ctx.bezierCurveTo(10,-3,11,6,17,12);
      ctx.bezierCurveTo(5,21,-5,18,-13,12);
      ctx.quadraticCurveTo(-5,0,-13,-13); ctx.closePath();
      ctx.fillStyle = gradient(-13,-18,17,18,[[0,'#c5d6e98c'],[.3,'#425368dd'],[.5,'#e3eeffb0'],[1,'#5d7498dd']]);
      ctx.fill(); ctx.strokeStyle = '#e5efff90'; ctx.lineWidth = .8; ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        const shift = i*7;
        ctx.beginPath(); ctx.moveTo(-11,shift-7);
        ctx.bezierCurveTo(-4,shift-3-release*10,4,shift+8+release*10,13,shift+5);
        ctx.strokeStyle = '#07101b95'; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = '#eef6ffc0'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.restore();
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
      const untwist = ease(0,.38,t), flat = ease(.16,.48,t), peel = ease(.36,.91,t);
      const screen = ctx; ctx = sheetCtx;
      ctx.resetTransform(); ctx.clearRect(0,0,sheet.width,sheet.height);
      ctx.setTransform(2,0,0,2,600,360);
      // Draw each tail independently, then the fixed printed center.
      ctx.save();
      for (const side of [-1,1]) film(side,flat,untwist);
      foil(flat,untwist);
      ctx.restore();
      knot(-1,untwist); knot(1,untwist);
      ctx = screen;
      ctx.save(); ctx.globalAlpha = 1-ease(.86,.96,t);
      ctx.rotate(mix(-.09,0,untwist));
      if (!peel) {
        ctx.drawImage(sheet,-300,-180,600,360); ctx.restore(); return;
      }
      // A travelling curl carries the entire printed sheet over the fold.
      // Drawing from bottom to top places the turned-back film over its front.
      const fold = mix(-180,235,peel), radius = 24;
      const foldedY = y => {
        if (y >= fold) return y;
        const distance = fold-y, arc = Math.min(distance/radius,Math.PI);
        return fold-radius*Math.sin(arc)+Math.max(0,distance-Math.PI*radius)*.28;
      };
      for (let y = 179; y >= -180; y--) {
        const top = foldedY(y), bottom = foldedY(y+1);
        ctx.save(); ctx.translate(0,top); ctx.scale(1,bottom < top ? -1 : 1);
        ctx.drawImage(sheet,0,(y+180)*2,1200,2,-300,0,600,Math.abs(bottom-top)+.7);
        ctx.restore();
      }
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
      const fan = ease(.42,.8,progress);
      if (fan) {
        ctx.save(); ctx.globalAlpha = ease(.42,.52,progress)*(1-ease(.96,1,progress));
        const order = Array.from({ length: count }, (_,i) => i).sort((a,b) => Math.abs(b-(count-1)/2)-Math.abs(a-(count-1)/2));
        for (const i of order) {
          const slot = i-(count-1)/2;
          candy(slot*82*fan,-28*fan+Math.abs(slot)*14*fan,candyColors[i%5],slot*.11*fan);
        }
        ctx.restore();
      }
      if (progress < .96) wrapper(progress);
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
