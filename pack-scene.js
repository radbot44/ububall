'use strict';
// Painted foil, cellophane and candy using only 2D canvas paths and transforms.
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
    let color, candyColors, previousColor = -1;
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
      const phase = side*(1-ease(0,.3,untwist))*Math.PI;
      const flip = Math.cos(phase), swing = Math.sin(phase);
      const outerOpen = ease(.25,.63,untwist), innerOpen = ease(.63,1,untwist);
      const ribs = [];
      // One material grid, divided at two shared crease rows. The bottom flap
      // lies over the top flap when closed, and each opens about its own crease.
      for (let j = 0; j <= 18; j++) {
        const v = j/9-1;
        const hinge = v < -1/3 ? -1/3 : v > 1/3 ? 1/3 : v;
        const opened = v < -1/3 ? innerOpen : v > 1/3 ? outerOpen : 1;
        const angle = (1-opened)*Math.PI;
        const foldedV = hinge+(v-hinge)*Math.cos(angle);
        const closedV = hinge-(v-hinge);
        // Release the gathered shape with its own flap, blending across the
        // middle section so both shared crease rows stay joined throughout.
        const spread = mix(innerOpen,outerOpen,ease(-1/3,1/3,v));
        const rib = [];
        for (let k = 0; k <= 8; k++) {
          const u = k/8, free = ease(0,.25,u);
          const outline = mix(closedV*3,v,spread);
          const closedX = 108+u*(84+64*Math.sqrt(Math.max(0,1-outline*outline)));
          const span = mix(mix(12,150,u),135,spread);
          const crinkle = Math.sin(j*1.7+u*4)*u*1.5*(1-spread);
          // The signed scale and lift are 2D hinge animation, not a second sheet.
          // At each crease the displacement is exactly zero on both panels.
          const lift = (v-hinge)*Math.sin(angle)*span*.4*free;
          const spunY = (foldedV*span+crinkle)*flip+lift
            + swing*u*8;
          rib.push({
            x: mix(closedX,108+u*160,spread)+u*foldedV*swing*10
              + lift*.15,
            // This edge overlaps the foil and follows its opening silhouette.
            // Neither spin nor flap lift may move it away from the body.
            y: mix(v*mix(12,135,flat),spunY,free)
          });
        }
        ribs.push(rib);
      }
      // All three panels remain present after opening, occupying adjacent regions.
      const order = flip < 0 ? [12,0,6] : [6,0,12];
      for (const start of order) filmPanel(side,ribs.slice(start,start+7),start/6);
    }
    function filmPanel(side, ribs, face) {
      const top = ribs[0], bottom = ribs[ribs.length-1];
      ctx.save(); ctx.scale(side,1); ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(top[0].x,top[0].y);
      for (const p of top.slice(1)) ctx.lineTo(p.x,p.y);
      for (const rib of ribs.slice(1)) ctx.lineTo(rib[8].x,rib[8].y);
      for (const p of [...bottom].reverse()) ctx.lineTo(p.x,p.y);
      ctx.closePath();
      // Three quiet face tones make the folds legible without a mesh of lines.
      ctx.fillStyle = ['#b8d1ed24','#dbe9f52e','#f0f6ff38'][face]; ctx.fill();
      ctx.strokeStyle = '#d7e7f17a'; ctx.lineWidth = 1.1; ctx.stroke();
      ctx.clip();
      ctx.fillStyle = gradient(125,-80,265,90,[[0,'#ffffff00'],[.48,'#ffffff00'],[.57,'#ffffff20'],[.67,'#ffffff00'],[1,'#ffffff00']]);
      ctx.fillRect(105,-160,170,320);
      // A single broken crease on each flap moves with that piece of film.
      const crease = ribs[3];
      ctx.beginPath(); ctx.moveTo(crease[2].x,crease[2].y);
      ctx.lineTo(crease[5].x,crease[5].y+2);
      ctx.lineTo(crease[7].x,crease[7].y);
      ctx.strokeStyle = '#eff7ff60'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
    function knot(side, untwist) {
      const release = ease(.08,.4,untwist);
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
      ctx.fillStyle = gradient(-13,-18,17,18,[[0,'#dceafa55'],[.5,'#afc6dc88'],[1,'#dceafa55']]);
      ctx.fill(); ctx.strokeStyle = '#e5efff90'; ctx.lineWidth = .8; ctx.stroke();
      for (let i = 0; i <= 1; i++) {
        const shift = i*7;
        ctx.beginPath(); ctx.moveTo(-11,shift-7);
        ctx.bezierCurveTo(-4,shift-3-release*10,4,shift+8+release*10,13,shift+5);
        ctx.strokeStyle = '#20324750'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = '#eef6ff80'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.restore();
    }
    function foil(flat) {
      ctx.save(); ctx.beginPath(); ctx.rect(-110,-135,220,270); ctx.clip();
      ctx.fillStyle = color; ctx.fillRect(-110,-135,220,270);
      // Painted curvature relaxes as the same sheet opens; its printed area never scales.
      const round = ctx.createRadialGradient(-35+pointer*12,-45,5,6,15,130);
      round.addColorStop(0,'#ffffff40'); round.addColorStop(.35,'#ffffff14'); round.addColorStop(.65,'#00000000'); round.addColorStop(.85,'#00000040'); round.addColorStop(1,'#00000065');
      ctx.globalAlpha *= 1-flat*.75; ctx.fillStyle = round; ctx.fillRect(-110,-135,220,270);
      ctx.globalAlpha /= 1-flat*.75;
      // A broad, soft reflection and four short folds keep the illustration calm.
      ctx.fillStyle = gradient(-90+pointer*10,-100,90,110,[[0,'#ffffff00'],[.4,'#ffffff20'],[.7,'#ffffff00'],[1,'#ffffff00']]);
      ctx.fillRect(-110,-135,220,270);
      ctx.strokeStyle = '#ffffff35'; ctx.lineWidth = 1.2;
      for (const side of [-1,1]) {
        ctx.beginPath(); ctx.moveTo(side*94,-45); ctx.quadraticCurveTo(side*84,-60,side*69,-68); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(side*95,51); ctx.quadraticCurveTo(side*84,65,side*72,70); ctx.stroke();
      }
      // Fixed-size printed logo, with a dark ink bed for all 32 wrapper colors.
      ctx.fillStyle = '#101217bb'; ctx.beginPath(); ctx.roundRect(-94,-32,188,64,6); ctx.fill();
      if (logo.complete && logo.naturalWidth) ctx.drawImage(logo,-88,-27,176,55);
      ctx.restore();
    }
    function wrapper(t) {
      const untwist = ease(0,.5,t), flat = ease(.25,1,untwist), peel = ease(.5,.94,t);
      const screen = ctx; ctx = sheetCtx;
      ctx.resetTransform(); ctx.clearRect(0,0,sheet.width,sheet.height);
      ctx.setTransform(2,0,0,2,600,360);
      film(-1,flat,untwist); film(1,flat,untwist);
      ctx.save(); ctx.beginPath(); ctx.rect(-110,-180,220,360); ctx.clip();
      silhouette(flat); ctx.clip(); foil(flat);
      silhouette(flat); ctx.strokeStyle = '#e9f1ff40'; ctx.lineWidth = .8; ctx.stroke();
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
      const fan = ease(.58,.86,progress);
      if (fan) {
        ctx.save(); ctx.globalAlpha = ease(.58,.68,progress)*(1-ease(.96,1,progress));
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
