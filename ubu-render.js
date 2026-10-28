'use strict';
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const roles = ['background', 'eyes', 'irises', 'pupils', 'mouth'];
  let serial = 0;
  function svgNode(tag, attrs = {}) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  }
  function material(defs, attribute, id, effects, cx = 180, cy = 180) {
    const rotate = `rotate(${attribute.angle} ${cx} ${cy})`;
    // One global material field: every detail rotates about the outer-circle center.
    const pattern = svgNode('pattern', { id, patternUnits: 'userSpaceOnUse', x: cx - 360, y: cy - 360,
      width: 720, height: 720, viewBox: '-180 -180 720 720', patternTransform: rotate });
    const lightLayers = [];
    const cover = fill => { const rect = svgNode('rect', { x: -180, y: -180, width: 720, height: 720, fill }); pattern.append(rect); return rect; };
    const rgb = (attribute.hex || '#808080').slice(1).match(/../g).map(v => parseInt(v, 16));
    const dark = (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) / 255 < .25;
    function animate(effect) { if (effects) (effects.idle ||= []).push(effect); }
    function sparkle(points, strength = 1) {
      const groups = Array.from({ length: 6 }, () => svgNode('g', { fill: '#fff', opacity: .3, 'data-sparkle': '' }));
      points.forEach(([x, y, r], i) => {
        groups[i % 6].append(svgNode('path', { d: `M${x-r} ${y}l${r*.8} ${-r*.2}l${r*.2} ${-r}l${r*.2} ${r}l${r*.8} ${r*.2}l${-r*.8} ${r*.2}l${-r*.2} ${r}l${-r*.2} ${-r}Z` }));
      });
      pattern.append(...groups);
      animate((x, y, time) => groups.forEach((g, i) => {
        const twinkle = Math.max(0, Math.sin(time * (.65 + i * .09) + i * 2.1)) ** 12;
        const glint = Math.max(0, Math.sin(x * 3 + y * 2 + i * 1.7)) ** 18;
        g.setAttribute('opacity', Math.min(1, .12 + strength * (.72 * twinkle + .55 * glint)));
      }));
      return groups;
    }

    function lighting(name, stops, radial = false, attrs = {}) {
      const key = id + '-' + name;
      const gradient = svgNode(radial ? 'radialGradient' : 'linearGradient', {
        id: key, gradientUnits: 'userSpaceOnUse',
        ...(radial ? { cx: 105, cy: 90, r: 265 } : { x1: 0, y1: 0, x2: 360, y2: 0 }), ...attrs
      });
      for (const [offset, color, opacity] of stops) gradient.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
      if (effects && attribute.texture !== 'starfield') {
        const base = attrs.gradientTransform || '';
        const radians = attribute.angle * Math.PI / 180;
        const strength = attribute.texture === 'matte' ? 15 : 65;
        effects.push((x, y) => {
          const dx = (x * Math.cos(radians) + y * Math.sin(radians)) * strength;
          const dy = (-x * Math.sin(radians) + y * Math.cos(radians)) * strength;
          gradient.setAttribute('gradientTransform', `translate(${dx} ${dy}) ${base}`);
        });
      }
      defs.append(gradient);
      lightLayers.push(cover(`url(#${key})`));
    }
    // Fixed procedural detail never consumes DNA or the naming stream.
    let state = 173;
    const roll = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    if (attribute.texture === 'metallic') {
      lighting('reflection', [[0, '#000', .58], [.12, '#fff', .18], [.27, '#000', .4],
        [.36, '#000', .62], [.405, '#fff', .85], [.44, '#fff', .38], [.51, '#000', .18],
        [.64, '#000', .52], [.72, '#fff', .58], [.77, '#fff', .12], [1, '#000', .4]]);
      const brush = svgNode('pattern', { id: id + '-brush', patternUnits: 'userSpaceOnUse', width: 72, height: 72 });
      for (let i = 0; i < 64; i++) {
        const y = roll() * 72;
        brush.append(svgNode('path', { d: `M0 ${y}h72`, stroke: i % 3 ? '#fff' : '#000',
          'stroke-width': .18 + roll() * .35, opacity: .025 + roll() * .065 }));
      }
      defs.append(brush); cover(`url(#${id}-brush)`);
    } else if (attribute.texture === 'glossy') {
      lighting('depth', [[0, '#fff', .16], [.3, '#fff', .02], [.7, '#000', .18], [1, '#000', .5]], true);
      lighting('softbox', [[0, '#fff', 0], [.17, '#fff', 0], [.25, '#fff', .12],
        [.30, '#fff', .58], [.34, '#fff', .7], [.38, '#fff', .25], [.46, '#fff', 0], [1, '#fff', 0]]);
      lighting('glint', [[0, '#fff', .85], [.24, '#fff', .48], [.65, '#fff', .08], [1, '#fff', 0]], true,
        { cx: 100, cy: 76, r: 58, gradientTransform: 'translate(0 38) scale(1 .5)' });
      lighting('edge', [[0, '#fff', 0], [.81, '#fff', 0], [.87, '#fff', .2], [.9, '#fff', 0], [1, '#fff', 0]]);
    } else if (attribute.texture === 'iridescent') {
      lighting('oil-depth', [[0, '#fff', .12], [.45, '#000', .06], [1, '#000', .38]], true);
      // Broad thin-film color bands curve across the surface, retaining the base color beneath.
      lighting('interference', [[0, '#8b5cff', .12], [.18, '#735dff', .48], [.3, '#ed61d3', .46],
        [.41, '#ffb66d', .35], [.5, '#e9ef92', .27], [.59, '#69edca', .43],
        [.7, '#49cfea', .5], [.82, '#7272f5', .44], [.94, '#de68ce', .35], [1, '#905cff', .2]], true,
        { cx: 70, cy: 70, r: 330, gradientTransform: 'translate(-20 25) skewX(-18)' });
      lighting('oil-sheen', [[0, '#fff', 0], [.22, '#fff', 0], [.32, '#dcfaff', .12],
        [.37, '#fff', .52], [.4, '#ffe9fa', .21], [.49, '#fff', 0], [1, '#fff', 0]]);
    } else if (attribute.texture === 'pearlescent') {
      lighting('nacre-depth', [[0, '#fff', .32], [.45, '#fff', .08], [1, '#000', .22]], true);
      lighting('nacre-color', [[0, '#d9f5ff', .12], [.25, '#fbe0ef', .3], [.46, '#fff3d7', .38],
        [.63, '#d8f8ed', .22], [.8, '#dcdfff', .28], [1, '#fff', .05]], true,
        { cx: 80, cy: 60, r: 355, gradientTransform: 'skewX(-12)' });
      lighting('pearl-sheen', [[0, '#fff', 0], [.2, '#fff', .04], [.38, '#fff', .38],
        [.5, '#fff', .16], [.7, '#fff', 0], [1, '#fff', 0]]);
    } else if (attribute.texture === 'damascus') {
      // Polished etched alloys: quantized turbulent bands with steel luster, without bevels or paired edge highlights.
      const etch = svgNode('filter', { id: id + '-etch', filterUnits: 'userSpaceOnUse',
        x: -180, y: -180, width: 720, height: 720, 'color-interpolation-filters': 'sRGB' });
      etch.append(svgNode('feTurbulence', { type: 'fractalNoise', baseFrequency: '.009 .023',
        numOctaves: 4, seed: 173, result: 'folds' }),
        svgNode('feColorMatrix', { type: 'matrix', values: '1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1' }));
      const bands = svgNode('feComponentTransfer');
      const levels = Array.from({ length: 48 }, (_, i) => i % 4 < 2 ? .06 : .94).join(' ');
      for (const channel of ['R', 'G', 'B']) bands.append(svgNode('feFunc' + channel, { type: 'discrete', tableValues: levels }));
      bands.append(svgNode('feFuncA', { type: 'linear', slope: .42 }));
      etch.append(bands); defs.append(etch);
      pattern.append(svgNode('rect', { x: -180, y: -180, width: 720, height: 720, filter: `url(#${id}-etch)` }));
      lighting('steel-flat', [[0, '#fff', .08], [.5, '#fff', .02], [1, '#000', .08]], true);
      lighting('steel-polish', [[0, '#fff', 0], [.2, '#fff', .02], [.36, '#fff', .18],
        [.43, '#fff', .32], [.51, '#fff', .12], [.66, '#fff', 0], [1, '#fff', 0]]);
    } else if (attribute.texture === 'marble') {
      lighting('stone-depth', [[0, '#fff', .24], [.5, '#fff', .04], [1, '#000', .18]], true);
      const cloud = svgNode('filter', { id: id + '-mineral', x: '-10%', y: '-10%', width: '120%', height: '120%' });
      cloud.append(svgNode('feTurbulence', { type: 'fractalNoise', baseFrequency: '.012 .025', numOctaves: 3, seed: 41 }),
        svgNode('feColorMatrix', { type: 'saturate', values: 0 }));
      defs.append(cloud);
      pattern.append(svgNode('rect', { x: -180, y: -180, width: 720, height: 720, filter: `url(#${id}-mineral)`, opacity: .22 }));
      for (let vein = 0; vein < 17; vein++) {
        let x = -230 + vein * 80, d = `M${x} -180`;
        const points = [];
        for (let y = -120; y <= 540; y += 60) {
          const next = x + (roll() - .48) * 140;
          d += `C${x + 28} ${y - 40} ${next - 24} ${y - 20} ${next} ${y}`;
          points.push([next, y]); x = next;
        }
        for (const [width, color, opacity] of [[6 + roll()*9, '#fff', .055], [1 + roll()*2.2, dark ? '#adb3b9' : '#000', .18], [.35, '#fff', .15]]) {
          pattern.append(svgNode('path', { d, fill: 'none', stroke: color, 'stroke-width': width, opacity }));
        }
        for (let i = 1; i < points.length; i += 3) {
          const [px, py] = points[i], direction = roll() < .5 ? -1 : 1;
          pattern.append(svgNode('path', { d: `M${px} ${py}q${direction * 35} -18 ${direction * 52} -52t${direction * 48} -65`,
            fill: 'none', stroke: dark ? '#b3b6bb' : '#000', 'stroke-width': .35 + roll()*.65, opacity: .18 }));
        }
      }
      lighting('stone-polish', [[0, '#fff', .25], [.35, '#fff', .08], [1, '#fff', 0]], true,
        { cx: 95, cy: 70, r: 210 });
    } else if (attribute.texture === 'lacquered') {
      lighting('lacquer-depth', [[0, '#fff', .06], [.35, '#000', .08], [.7, '#000', .32], [1, '#000', .62]], true);
      lighting('lacquer-reflection', [[0, '#fff', 0], [.23, '#fff', 0], [.275, '#fff', .12],
        [.29, '#fff', .85], [.335, '#fff', .72], [.35, '#fff', .1], [.39, '#fff', 0], [1, '#fff', 0]]);
      lighting('lacquer-bounce', [[0, '#fff', 0], [.68, '#fff', 0], [.77, '#fff', .18],
        [.81, '#fff', .3], [.83, '#fff', 0], [1, '#fff', 0]]);
    } else if (attribute.texture === 'velvet') {
      // Fine low-contrast nap with broad brushed patches, never glittering noise.
      lighting('nap-brush', [[0,'#fff',.045],[.4,'#fff',.09],[.7,'#000',.035],[1,'#fff',.02]], true,
        { cx: 80, cy: 160, r: 310, gradientTransform: 'scale(1 .8)' });
      lighting('velvet-diffuse', [[0, '#000', .08], [.5, '#000', .13], [1, '#000', .22]], true);
      const nap = svgNode('filter', { id: id + '-nap', filterUnits: 'userSpaceOnUse',
        x: -180, y: -180, width: 720, height: 720, 'color-interpolation-filters': 'sRGB' });
      nap.append(svgNode('feTurbulence', { type: 'fractalNoise', baseFrequency: '.65 .85', numOctaves: 2, seed: 173 }),
        svgNode('feColorMatrix', { type: 'saturate', values: 0 }));
      const napContrast = svgNode('feComponentTransfer');
      for (const channel of ['R', 'G', 'B']) napContrast.append(svgNode('feFunc' + channel,
        { type: 'linear', slope: .8, intercept: .12 }));
      napContrast.append(svgNode('feFuncA', { type: 'linear', slope: 0, intercept: 1 }));
      nap.append(napContrast);
      defs.append(nap);
      pattern.append(svgNode('rect', { x: -180, y: -180, width: 720, height: 720,
        filter: `url(#${id}-nap)`, opacity: .14 }));
    } else if (attribute.texture === 'frosted') {
      lighting('ice-body', [[0, '#e3faff', .42], [.45, '#c9e9fa', .2], [1, '#84accb', .1]], true);
      const frost = svgNode('pattern', { id: id + '-frost', patternUnits: 'userSpaceOnUse', width: 120, height: 120 });
      for (let i = 0; i < 46; i++) {
        const x = roll() * 120, y = roll() * 120, length = 5 + roll() * 15;
        let d = `M0 0V${-length}`;
        for (let j = 1; j <= 5; j++) {
          const yb = -length * j / 6, branch = length * (1 - j / 7) * .3;
          d += `M0 ${yb}l${branch} ${-branch}m${-branch} ${branch}l${-branch} ${-branch}`;
        }
        frost.append(svgNode('path', { d, transform: `translate(${x} ${y}) rotate(${roll() * 360})`,
          fill: 'none', stroke: i % 4 ? '#ecfcff' : '#648da9', 'stroke-width': .4 + roll() * .45,
          'stroke-linecap': 'round', opacity: .2 + roll() * .28 }));
      }
      for (let i = 0; i < 150; i++) {
        const x = roll() * 120, y = roll() * 120, r = .5 + roll() * 1.3;
        frost.append(svgNode('path', { d: `M${x} ${y-r}l${r*.5} ${r}l${-r*.5} ${r}l${-r*.5} ${-r}Z`,
          fill: '#e6faff', opacity: .12 + roll() * .3 }));
      }
      defs.append(frost); cover(`url(#${id}-frost)`);
      lighting('ice-glint', [[0, '#fff', 0], [.3, '#fff', .03], [.43, '#defaff', .3],
        [.49, '#fff', .04], [1, '#fff', 0]]);
      sparkle(Array.from({length: 85}, () => [-160+roll()*680, -160+roll()*680, 1+roll()*1.5]), .85);
    } else if (attribute.texture === 'woodgrain') {
      lighting('wood-depth', [[0, '#fff', .2], [.5, '#fff', .02], [1, '#000', .24]], true);
      if (dark) pattern.append(svgNode('rect', { x:-180,y:-180,width:720,height:720,fill:'#b7a897',opacity:.075 }));
      // Long fibers bend around a fixed knot; the palette color remains the stain.
      for (let fiber = -28; fiber <= 100; fiber++) {
        const baseX = fiber * 6 + roll() * 3;
        let d = '';
        for (let y = -180; y <= 540; y += 8) {
          const distance = baseX - 140;
          const bend = Math.sign(distance) * 26 * Math.exp(-distance * distance / 1800 - (y - 180) ** 2 / 6500);
          const x = baseX + bend + 3 * Math.sin(y / 65 + fiber * .16) + 1.2 * Math.sin(y / 19 + fiber);
          d += `${y === -180 ? 'M' : 'L'}${x.toFixed(2)} ${y}`;
        }
        pattern.append(svgNode('path', { d, fill: 'none', stroke: fiber % 4 ? (dark ? '#a69a8b' : '#000') : (dark ? '#000' : '#fff'),
          'stroke-width': .5 + roll() * 1.4, opacity: (dark ? .055 : .1) + roll() * (dark ? .09 : .17) }));
      }
      for (let ring = 1; ring <= 5; ring++) pattern.append(svgNode('ellipse', {
        cx: 140, cy: 180, rx: ring * 3, ry: ring * 9, fill: 'none', stroke: dark ? '#a69a8b' : '#000',
        'stroke-width': .7, opacity: .23 - ring * .02 }));
      lighting('wood-satin', [[0, '#fff', 0], [.35, '#fff', .12], [.6, '#fff', .04], [1, '#fff', 0]]);
    } else if (attribute.texture === 'holographic') {
      lighting('foil-depth', [[0, '#fff', .18], [.3, '#000', .18], [.65, '#fff', .22], [1, '#000', .3]]);
      lighting('diffraction', [[0, '#ff709d', .48], [.16, '#ffe66c', .55], [.32, '#84ffaf', .5],
        [.48, '#6be9ff', .6], [.64, '#8b91ff', .55], [.8, '#ed7cff', .58], [1, '#ff709d', .48]], false,
        { x1: 0, y1: 0, x2: 160, y2: 80, spreadMethod: 'reflect' });
      const grooves = svgNode('pattern', { id: id + '-grooves', patternUnits: 'userSpaceOnUse', width: 4, height: 4 });
      grooves.append(svgNode('path', { d: 'M0 0h4', stroke: '#fff', 'stroke-width': .45, opacity: .18 }));
      defs.append(grooves); cover(`url(#${id}-grooves)`);
      lighting('foil-flash', [[0, '#fff', 0], [.38, '#fff', 0], [.46, '#fff', .68],
        [.5, '#fff', .12], [.57, '#fff', 0], [1, '#fff', 0]]);
    } else if (attribute.texture === 'terrazzo') {
      lighting('stone-matrix', [[0, '#fff', .17], [.5, '#fff', .03], [1, '#000', .18]], true);
      for (let i = 0; i < 440; i++) {
        const cx = -180 + roll() * 720, cy = -180 + roll() * 720;
        const radius = 2 + roll() * 8, count = 3 + Math.floor(roll() * 4), points = [];
        for (let vertex = 0; vertex < count; vertex++) {
          const angle = (vertex + roll() * .4) * Math.PI * 2 / count;
          const r = radius * (.55 + roll() * .45);
          points.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
        }
        pattern.append(svgNode('polygon', { points: points.join(' '),
          fill: ['#fff', '#000', '#ead9c5', '#a7b6b7'][i % 4], opacity: .22 + roll() * .4 }));
      }
      lighting('aggregate-polish', [[0, '#fff', .15], [.4, '#fff', .04], [1, '#fff', 0]], true);
    } else if (attribute.texture === 'crackle') {
      lighting('glaze-depth', [[0, '#fff', .2], [.5, '#fff', .02], [1, '#000', .22]], true);
      // Voronoi cells share exact borders, making a connected, irregular glaze network.
      const seeds = [];
      for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
        seeds.push([-180 + (x + .2 + roll() * .6) * 80, -180 + (y + .2 + roll() * .6) * 80]);
      }
      for (const seed of seeds) {
        let cell = [[-180, -180], [540, -180], [540, 540], [-180, 540]];
        for (const other of seeds) {
          if (other === seed || !cell.length) continue;
          const nx = other[0] - seed[0], ny = other[1] - seed[1];
          const limit = (other[0] ** 2 + other[1] ** 2 - seed[0] ** 2 - seed[1] ** 2) / 2;
          const clipped = [];
          for (let i = 0; i < cell.length; i++) {
            const a = cell[i], b = cell[(i + 1) % cell.length];
            const da = a[0] * nx + a[1] * ny - limit, db = b[0] * nx + b[1] * ny - limit;
            if (da <= 0) clipped.push(a);
            if ((da <= 0) !== (db <= 0)) {
              const t = da / (da - db);
              clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
          }
          cell = clipped;
        }
        // Sample a common displacement field so adjacent cracks retain matching ragged edges.
        const rough = [];
        for (let i = 0; i < cell.length; i++) {
          const a = cell[i], b = cell[(i + 1) % cell.length];
          const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
          for (let j = 0; j < steps; j++) {
            const x = a[0] + (b[0] - a[0]) * j / steps, y = a[1] + (b[1] - a[1]) * j / steps;
            rough.push([x + 3.5 * Math.sin(y / 7 + x / 19) + .9 * Math.sin(y * 1.7 + x),
              y + 3.5 * Math.sin(x / 8 - y / 23) + .9 * Math.sin(x * 1.5 - y)]);
          }
        }
        const d = 'M' + rough.map(p => p.map(v => v.toFixed(2)).join(',')).join('L') + 'Z';
        pattern.append(svgNode('path', { d, fill: '#fff', 'fill-opacity': roll() * .07,
          stroke: '#fff', 'stroke-opacity': .2, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
          svgNode('path', { d, fill: 'none', stroke: '#000', 'stroke-opacity': .48,
            'stroke-width': 1.15, 'stroke-linejoin': 'round' }));
        const chips = ['', ''];
        for (let i = 2; i < rough.length; i += 5) {
          const [x, y] = rough[i], r = .5 + roll() * 1.8;
          chips[i % 3 ? 0 : 1] += `M${(x-2).toFixed(2)} ${y.toFixed(2)}l${r.toFixed(2)} ${(-r).toFixed(2)}l${(r*.7).toFixed(2)} ${(r*1.4).toFixed(2)}Z`;
          roll();
        }
        chips.forEach((d,i) => pattern.append(svgNode('path', { d, fill:i?'#fff':'#000', opacity:.25 })));
      }
      lighting('glaze-sheen', [[0, '#fff', 0], [.3, '#fff', .04], [.42, '#fff', .25],
        [.55, '#fff', .02], [1, '#fff', 0]]);
    } else if (attribute.texture === 'plush') {
      lighting('plush-depth', [[0, '#fff', .12], [.5, '#000', .04], [1, '#000', .25]], true);
      // Overlapping rounded curls form a soft, deep pile, with no woven grid.
      const tufts = svgNode('pattern', { id: id + '-tufts', patternUnits: 'userSpaceOnUse', width: 96, height: 96 });
      const paths = ['', '', ''];
      for (let i = 0; i < 1800; i++) {
        const x = roll() * 96, y = roll() * 96, r = 1 + roll() * 2.4, lean = (roll() - .5) * 3;
        // Wrap curls across the tile boundary so no straight seams appear.
        for (const dx of [-96, 0, 96]) for (const dy of [-96, 0, 96]) {
          if (x + dx < -5 || x + dx > 101 || y + dy < -5 || y + dy > 101) continue;
          paths[i % 3] += `M${x+dx} ${y+dy}q${-r} ${-r*1.5} ${lean} ${-r*2}q${r} ${-r*.4} ${r*.7} ${r}`;
        }
      }
      for (let i = 0; i < 3; i++) tufts.append(svgNode('path', { d: paths[i], fill: 'none',
        stroke: i ? '#fff' : '#000', 'stroke-width': i === 2 ? .55 : 1.2,
        'stroke-linecap': 'round', opacity: i === 0 ? .16 : i === 1 ? .12 : .2 }));
      defs.append(tufts); cover(`url(#${id}-tufts)`);
    } else if (attribute.texture === 'opalescent') {
      lighting('opal-body', [[0, '#fff', .38], [.5, '#fff', .18], [1, '#000', .16]], true);
      const colors = ['#73efc0', '#ffbd72', '#8da4ff', '#ed8bda', '#8ce6ff'];
      for (let i = 0; i < 28; i++) {
        const color = colors[i % colors.length];
        lighting('opal-fire-' + i, [[0, color, .42], [.45, color, .28], [1, color, 0]], true,
          { cx: -70 + roll() * 500, cy: -70 + roll() * 500, r: 25 + roll() * 50 });
      }
      lighting('opal-polish', [[0, '#fff', .45], [.3, '#fff', .16], [1, '#fff', 0]], true,
        { cx: 105, cy: 80, r: 135 });
    } else if (attribute.texture === 'matte') {
      // Printed matte parts share one flat light field, not individual domes.
      lighting('diffuse', [[0, '#fff', .12], [.5, '#fff', .02], [1, '#000', .07]], false,
        { x1: 0, y1: 0, x2: 360, y2: 360 });
      const grain = svgNode('pattern', { id: id + '-grain', patternUnits: 'userSpaceOnUse', width: 48, height: 48 });
      for (let i = 0; i < 160; i++) {
        grain.append(svgNode('circle', { cx: 1 + roll() * 46, cy: 1 + roll() * 46,
          r: .18 + roll() * .22, fill: i % 2 ? '#fff' : '#000', opacity: .018 + roll() * .032 }));
      }
      defs.append(grain); cover(`url(#${id}-grain)`);
    } else if (attribute.texture === 'crystalline') {
      // An irregular triangulated field avoids a visibly repeating gemstone stamp.
      const points = [];
      for (let y = 0; y <= 12; y++) {
        points[y] = [];
        for (let x = 0; x <= 12; x++) points[y][x] = [-180 + x * 60 + (roll() - .5) * 32, -180 + y * 60 + (roll() - .5) * 32];
      }
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
        const a = points[y][x], b = points[y][x + 1], c = points[y + 1][x], d = points[y + 1][x + 1];
        const split = roll() < .5;
        const facets = split ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
        for (const triangle of facets) {
          const light = roll(), fill = light > .46 ? '#fff' : '#000';
          const opacity = .08 + Math.abs(light - .46) * .86;
          const facet = svgNode('polygon', { points: triangle.map(p => p.join(',')).join(' '), fill, opacity });
          pattern.append(facet);
          if (effects) {
            const normal = light * Math.PI * 2 + attribute.angle * Math.PI / 180;
            effects.push((x, y) => facet.setAttribute('opacity', Math.max(.025,
              Math.min(.78, opacity + .22 * (x * Math.cos(normal) + y * Math.sin(normal))))));
          }
        }
        if (roll() > .76) pattern.append(svgNode('path', { d: split ? `M${b}L${c}` : `M${a}L${d}`, fill: 'none',
          stroke: '#fff', 'stroke-width': .65, opacity: .38 }));
      }
      if (effects) for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) {
        if ((x + y * 3) % 4) continue;
        const [px, py] = points[y][x];
        const spark = svgNode('path', { d: `M${px - 5} ${py}h10M${px} ${py - 5}v10`,
          stroke: '#fff', 'stroke-width': 1.25, 'stroke-linecap': 'round', opacity: 0 });
        pattern.append(spark);
        const phase = (x * 1.7 + y * 2.3 + attribute.angle * Math.PI / 180);
        effects.push((dx, dy) => {
          const alignment = Math.max(0, Math.cos(phase + dx * 3 + dy * 2));
          spark.setAttribute('opacity', Math.pow(alignment, 22) * Math.min(1, Math.hypot(dx, dy) * 3.4));
        });
      }
      lighting('luster', [[0, '#fff', .3], [.4, '#fff', 0], [1, '#000', .3]], true);
    } else if (attribute.texture === 'granite') {
      // A dense, multiscale mineral matrix, grouped into compound paths.
      const stone = svgNode('pattern', { id: id + '-minerals', patternUnits: 'userSpaceOnUse', width: 144, height: 144 });
      const minerals = ['', '', '', '', '', ''];
      for (let y = -1; y < 49; y++) for (let x = -1; x < 49; x++) {
        const px = x*3 + roll()*2, py = y*3 + roll()*2;
        const r = 1.5 + roll()*2.5;
        let d = '';
        for (let v=0;v<5;v++) {
          const a = v*Math.PI*2/5, size = r*(.65+roll()*.35);
          d += `${v ? 'L' : 'M'}${(px+Math.cos(a)*size).toFixed(2)} ${(py+Math.sin(a)*size).toFixed(2)}`;
        }
        minerals[Math.floor(roll()*6)] += d+'Z';
      }
      const colors = ['#fff', '#000', '#fff', '#000', '#e3cbbb', '#889098'];
      minerals.forEach((d,i) => stone.append(svgNode('path', { d, fill: colors[i], opacity: [.22,.32,.4,.17,.18,.22][i] })));
      defs.append(stone); cover(`url(#${id}-minerals)`);
      lighting('granite-depth', [[0, '#fff', .06], [.5, '#fff', 0], [1, '#000', .13]], true);
    } else if (attribute.texture === 'satin') {
      lighting('satin-depth', [[0, '#fff', .16], [.3, '#fff', .04], [.65, '#000', .03], [1, '#000', .16]], true);
      // Fine silky fibers with alternating thread opacity
      const silk = svgNode('pattern', { id: id + '-silk', patternUnits: 'userSpaceOnUse', width: 48, height: 48 });
      for (let i = 0; i < 32; i++) {
        const y = i * 1.5;
        silk.append(svgNode('path', {
          d: `M0 ${y}q12 -0.65 24 0t24 0`, fill: 'none',
          stroke: i % 2 ? '#ffffff' : '#000000',
          'stroke-width': 0.75,
          opacity: 0.012 + roll() * 0.025
        }));
      }
      defs.append(silk); cover(`url(#${id}-silk)`);
      // Broad curved glints suggest the soft drape of satin rather than metal.
      const silkLight = svgNode('radialGradient', { id: id + '-drape' });
      for (const [offset, opacity] of [[0, .36], [.35, .22], [.7, .06], [1, 0]]) {
        silkLight.append(svgNode('stop', { offset, 'stop-color': '#fff', 'stop-opacity': opacity }));
      }
      defs.append(silkLight);
      for (const [x, y, rx, ry, angle] of [[85, 100, 65, 310, -25], [300, 285, 90, 330, 24]]) {
        pattern.append(svgNode('ellipse', { cx: x, cy: y, rx, ry,
          transform: `rotate(${angle} ${x} ${y})`, fill: `url(#${id}-drape)` }));
      }
      lighting('satin-sheen', [[0, '#fff', 0], [.28, '#fff', .025], [.5, '#fff', .1], [.72, '#fff', .025], [1, '#fff', 0]]);
    } else if (attribute.texture === 'sandstone') {
      // Broad continuous strata share their curvature; fine grain supplies the surface.
      for (let band=-6;band<27;band++) {
        const y = band*26 + Math.sin(band*1.7)*9;
        const d = `M-180 ${y}C60 ${y-60} 300 ${y+60} 540 ${y}L540 ${y+26}C300 ${y+86} 60 ${y-34} -180 ${y+26}Z`;
        pattern.append(svgNode('path', { d, fill: band%3 ? '#000' : '#fff', opacity: .035+roll()*.075 }));
      }
      const sand = svgNode('pattern', { id: id+'-sand', patternUnits: 'userSpaceOnUse', width: 96, height: 96 });
      const grains = ['', '', '', ''];
      for (let i=0;i<7000;i++) {
        const x=roll()*96, y=roll()*96, r=.4+roll()*.65;
        grains[i%4] += `M${x.toFixed(2)} ${y.toFixed(2)}h${r.toFixed(2)}v${r.toFixed(2)}h-${r.toFixed(2)}Z`;
      }
      grains.forEach((d,i) => sand.append(svgNode('path', { d, fill: i%2 ? '#fff' : '#000', opacity: i<2 ? .28 : .13 })));
      defs.append(sand); cover(`url(#${id}-sand)`);
      lighting('sandstone-depth', [[0, '#fff', .06], [.5, '#fff', 0], [1, '#000', .1]], true);
    } else if (attribute.texture === 'starfield') {
      lighting('starfield-space', [[0,'#040516',.35],[.6,'#030513',.6],[1,'#000',.8]], true);
      const far=svgNode('g'), near=svgNode('g'), stars=svgNode('g');
      const colors=['#526cbf','#b15add','#408ba8','#d28a9d'];
      for(let i=0;i<22;i++) {
        const x=-150+roll()*650,y=-150+roll()*650,r=45+roll()*120;
        const grad=svgNode('radialGradient',{id:id+'-nebula-'+i});
        for(const [offset,opacity] of [[0,.5],[.35,.23],[1,0]])grad.append(svgNode('stop',{offset,'stop-color':colors[i%4],'stop-opacity':opacity}));
        defs.append(grad);far.append(svgNode('ellipse',{cx:x,cy:y,rx:r,ry:r*(.35+roll()*.5),transform:`rotate(${roll()*180} ${x} ${y})`,fill:`url(#${id}-nebula-${i})`}));
      }
      const dust=svgNode('radialGradient',{id:id+'-depth-dust'});
      for(const [offset,opacity] of [[0,.8],[.45,.38],[1,0]])dust.append(svgNode('stop',{offset,'stop-color':'#030511','stop-opacity':opacity}));
      defs.append(dust);
      for(let i=0;i<12;i++)near.append(svgNode('ellipse',{cx:-150+roll()*650,cy:-150+roll()*650,rx:80+roll()*100,ry:16+roll()*35,transform:'rotate(-28 180 180)',fill:`url(#${id}-depth-dust)`}));
      const glints=[];
      for(let i=0;i<220;i++) {
        const x=-160+roll()*680,y=-160+roll()*680,r=.15+roll()**3*1.1;
        stars.append(svgNode('circle',{cx:x,cy:y,r,fill:i%4?'#f4f7ff':'#aacbff',opacity:.2+roll()*.65}));
        if(r>.65)glints.push([x,y,r*3]);
      }
      const wisps=svgNode('filter',{id:id+'-wisps',x:'-10%',y:'-10%',width:'120%',height:'120%','color-interpolation-filters':'sRGB'});
      wisps.append(svgNode('feTurbulence',{type:'fractalNoise',baseFrequency:'.012 .023',numOctaves:3,seed:67,result:'clouds'}),
        svgNode('feColorMatrix',{in:'clouds',type:'matrix',values:'0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2 -.45',result:'density'}),
        svgNode('feComposite',{in:'SourceGraphic',in2:'density',operator:'in'}));
      defs.append(wisps);far.setAttribute('filter',`url(#${id}-wisps)`);
      pattern.append(far,near,stars);const starSparkles=sparkle(glints,1.1);
      if(effects)effects.push((x,y)=>{
        // Foreground dust moves most; the distant nebula remains almost fixed.
        far.setAttribute('transform',`translate(${-x*3} ${-y*3})`);
        near.setAttribute('transform',`translate(${-x*22} ${-y*22})`);
        stars.setAttribute('transform',`translate(${-x*8} ${-y*8})`);
        for (const group of starSparkles) group.setAttribute('transform',`translate(${-x*8} ${-y*8})`);
      });
    } else if (attribute.texture === 'quartz') {
      lighting('quartz-body', [[0,'#fff',.16],[.5,'#fff',.02],[1,'#000',.18]],true);
      const crystal=svgNode('linearGradient',{id:id+'-crystal',x1:'0%',y1:'0%',x2:'100%',y2:'25%'});
      for(const [offset,color,opacity] of [[0,'#fff',.32],[.24,'#fff',.04],[.55,'#000',.12],[.8,'#fff',.24],[1,'#fff',.06]])
        crystal.append(svgNode('stop',{offset,'stop-color':color,'stop-opacity':opacity}));
      defs.append(crystal);
      const crystalTips = [];
      // Unequal overlapping prisms, with long faces and pointed terminations.
      for(let i=0;i<85;i++) {
        const x=-160+roll()*680,y=-160+roll()*680,w=10+roll()*20,h=32+roll()*85;
        const angle=-45+roll()*90;
        const group=svgNode('g',{transform:`translate(${x} ${y}) rotate(${angle})`});
        crystalTips.push([x+h*Math.sin(angle*Math.PI/180), y-h*Math.cos(angle*Math.PI/180), 1.4+roll()*1.7]);
        group.append(svgNode('path',{d:`M0 ${-h}L${w} ${-h+w}V${h*.45}L0 ${h*.65}L${-w} ${h*.45}V${-h+w}Z`,fill:`url(#${id}-crystal)`}));
        group.append(svgNode('path',{d:`M0 ${-h}L${w*.2} ${-h+w*1.5}V${h*.6}L${-w} ${h*.45}V${-h+w}Z`,fill:'#fff',opacity:.08+roll()*.13}));
        group.append(svgNode('path',{d:`M0 ${-h}L${w*.2} ${-h+w*1.5}L${w} ${-h+w}Z`,fill:'#fff',opacity:.22+roll()*.2}));
        group.append(svgNode('path',{d:`M${-w} ${h*.3}V${-h+w}L0 ${-h}`,fill:'none',stroke:'#e6f6ff','stroke-width':.65,opacity:.35}));
        const fracture=-h*.5+roll()*h*.7;
        group.append(svgNode('path',{d:`M${-w*.8} ${fracture}l${w*.9} ${-w*.3}l${w*.7} ${w*.5}`,fill:'none',stroke:'#fff','stroke-width':.5,opacity:.12}));
        pattern.append(group);
      }
      sparkle(crystalTips);
      lighting('quartz-glint',[[0,'#fff',0],[.3,'#fff',.02],[.45,'#e8faff',.2],[.6,'#fff',.02],[1,'#fff',0]]);
    } else if (attribute.texture === 'obsidian') {
      lighting('obsidian-glass', [[0, '#fff', .08], [.35, '#000', .12], [1, '#000', .55]], true);
      // Broad shell-like fracture surfaces, with glints on selected curved lips.
      const shell = svgNode('linearGradient', { id: id+'-shell', x1: '0%', y1: '0%', x2: '75%', y2: '100%' });
      for (const [offset,color,opacity] of [[0,'#fff',.18],[.12,'#fff',.035],[.55,'#000',.05],[1,'#000',.38]]) {
        shell.append(svgNode('stop', { offset, 'stop-color':color, 'stop-opacity':opacity }));
      }
      defs.append(shell);
      for (let row=-1;row<5;row++) for (let col=-1;col<5;col++) {
        const x=col*150+(roll()-.5)*80, y=row*145+(roll()-.5)*70;
        const w=75+roll()*90, h=55+roll()*85;
        const lip=`M${x-w} ${y}C${x-w*.4} ${y-h*.9} ${x+w*.35} ${y-h*.6} ${x+w} ${y+h*.2}`;
        const d=lip+`Q${x+w*.4} ${y+h*.85} ${x-w*.5} ${y+h}Q${x-w*.7} ${y+h*.25} ${x-w} ${y}Z`;
        pattern.append(svgNode('path', { d, fill:`url(#${id}-shell)` }));
        if ((row+col)%3===0) pattern.append(svgNode('path', { d:lip, fill:'none', stroke:'#fff', 'stroke-width':.65, opacity:.12 }));
      }
      lighting('obsidian-reflection', [[0,'#fff',0],[.3,'#fff',.02],[.48,'#fff',.26],[.64,'#fff',.04],[1,'#fff',0]], true,
        { cx:65, cy:35, r:310, gradientTransform:'translate(30 -15) skewX(-25)' });
    } else if (attribute.texture === 'mosaic') {
      // Small hand-cut tesserae with inset faces, exposed bevels and recessed grout.
      cover('rgba(25,23,21,0.4)');
      const glaze=svgNode('linearGradient',{id:id+'-glaze',x1:'0%',y1:'0%',x2:'75%',y2:'100%'});
      for(const [offset,color,opacity] of [[0,'#fff',.3],[.3,'#fff',.04],[.75,'#000',.04],[1,'#000',.16]])
        glaze.append(svgNode('stop',{offset,'stop-color':color,'stop-opacity':opacity}));
      defs.append(glaze);
      for(let row=-10;row<28;row++) for(let col=-10;col<28;col++) {
        const x=col*20+(row%2)*8,y=row*20;
        const pts=[[x+1+roll(),y+1+roll()],[x+18-roll(),y+1+roll()],[x+18-roll(),y+18-roll()],[x+1+roll(),y+18-roll()]];
        const points=pts.map(p=>p.join(',')).join(' ');
        pattern.append(svgNode('polygon',{points,fill:attribute.hex}));
        pattern.append(svgNode('polygon',{points,fill:roll()>.5?'#fff':'#000',opacity:.04+roll()*.14}));
        pattern.append(svgNode('polygon',{points,fill:`url(#${id}-glaze)`}));
        pattern.append(svgNode('path',{d:`M${pts[3]}L${pts[0]}L${pts[1]}`,fill:'none',stroke:'#fff','stroke-width':.85,opacity:.3}));
        pattern.append(svgNode('path',{d:`M${pts[1]}L${pts[2]}L${pts[3]}`,fill:'none',stroke:'#000','stroke-width':1.1,opacity:.4}));
      }
    } else if (attribute.texture === 'hammered-metal') {
      lighting('hammered-base', [[0,'#000',.25],[.25,'#fff',.08],[.48,'#fff',.3],[.7,'#000',.08],[1,'#000',.3]]);
      const dent = svgNode('linearGradient', { id:id+'-dent', x1:'10%', y1:'0%', x2:'85%', y2:'100%' });
      const dentStops = [[0,'#fff',.04],[.2,'#000',.16],[.5,'#000',.025],[.8,'#fff',.15],[1,'#fff',.025]];
      for (const [offset,color,opacity] of dentStops) dent.append(svgNode('stop', { offset, 'stop-color':color, 'stop-opacity':opacity }));
      defs.append(dent);
      const tile=svgNode('pattern',{id:id+'-dents',patternUnits:'userSpaceOnUse',width:160,height:160});
      const grid = Array.from({length:13}, (_,y) => Array.from({length:13}, (_,x) => [-16+x*16+(roll()-.5)*13,-16+y*16+(roll()-.5)*13]));
      for (let y=0;y<12;y++) for (let x=0;x<12;x++) {
        const pts=[grid[y][x],grid[y][x+1],grid[y+1][x+1],grid[y+1][x]];
        const mid=pts.map((p,i)=>p.map((v,j)=>(v+pts[(i+1)%4][j])/2));
        let d=`M${mid[3].join(' ')}`;
        for (let i=0;i<4;i++) d+=`Q${pts[i].join(' ')} ${mid[i].join(' ')}`;
        tile.append(svgNode('path', { d:d+'Z', fill:`url(#${id}-dent)` }));
      }
      defs.append(tile); cover(`url(#${id}-dents)`);
    } else if (attribute.texture === 'kintsugi') {
      lighting('kintsugi-glaze',[[0,'#fff',.12],[.5,'#fff',.02],[1,'#000',.2]],true);
      const gold=svgNode('linearGradient',{id:id+'-gold',gradientUnits:'userSpaceOnUse',x1:0,y1:0,x2:300,y2:220,spreadMethod:'reflect'});
      for(const [offset,color] of [[0,'#8b5619'],[.24,'#c79535'],[.45,'#f0d681'],[.49,'#fff1b6'],[.56,'#bf8525'],[1,'#6b4015']])
        gold.append(svgNode('stop',{offset,'stop-color':color}));
      defs.append(gold);
      if(effects) effects.push((x,y)=>gold.setAttribute('gradientTransform',`translate(${x*35} ${y*35})`));
      const seeds = [];
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
        seeds.push([-180 + (x + 0.2 + roll() * 0.6) * 105, -180 + (y + 0.2 + roll() * 0.6) * 105]);
      }
      for (let s = 0; s < seeds.length; s++) {
        const seed = seeds[s];
        let cell = [[-180, -180], [540, -180], [540, 540], [-180, 540]];
        for (const other of seeds) {
          if (other === seed || !cell.length) continue;
          const nx = other[0] - seed[0], ny = other[1] - seed[1];
          const limit = (other[0] ** 2 + other[1] ** 2 - seed[0] ** 2 - seed[1] ** 2) / 2;
          const clipped = [];
          for (let i = 0; i < cell.length; i++) {
            const a = cell[i], b = cell[(i + 1) % cell.length];
            const da = a[0] * nx + a[1] * ny - limit, db = b[0] * nx + b[1] * ny - limit;
            if (da <= 0) clipped.push(a);
            if ((da <= 0) !== (db <= 0)) {
              const t = da / (da - db);
              clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
          }
          cell = clipped;
        }
        if (!cell.length) continue;
        const rough=[];
        for(let k=0;k<cell.length;k++) {
          const a=cell[k],b=cell[(k+1)%cell.length],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/7);
          for(let j=0;j<n;j++) {
            const x=a[0]+(b[0]-a[0])*j/n,y=a[1]+(b[1]-a[1])*j/n;
            rough.push([x+1.4*Math.sin(y*.23)+.7*Math.sin(y*.67),y+1.4*Math.sin(x*.19)]);
          }
        }
        const d='M'+rough.map(p=>p.join(',')).join('L')+'Z';
        pattern.append(svgNode('path',{d,fill:s%2?'#fff':'#000','fill-opacity':.015+roll()*.035,stroke:'#382511','stroke-width':3.8,'stroke-linejoin':'round'}));
        pattern.append(svgNode('path',{d,fill:'none',stroke:`url(#${id}-gold)`,'stroke-width':1.8+roll()*.9,'stroke-linejoin':'round'}));
      }
    } else if (attribute.texture === 'leather') {
      lighting('leather-depth', [[0, '#fff', .08], [.4, '#000', .03], [1, '#000', .2]], true);
      const grain = svgNode('pattern', { id: id + '-grain', patternUnits: 'userSpaceOnUse', width: 96, height: 96 });
      grain.append(svgNode('rect', { width: 96, height: 96, fill: '#000', opacity: .14 }));
      // Shared jittered corners keep the fine pebbles packed, without a hexagonal grid.
      const corners = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => [(roll()-.5)*2.8, (roll()-.5)*2.8]));
      const corner = (x, y) => {
        const jitter = corners[(y+24)%24][(x+24)%24];
        return [x*4+jitter[0], y*4+jitter[1]];
      };
      const cells = ['', '', '', ''];
      let grainGlints = '';
      for (let row = -1; row <= 24; row++) {
        for (let col = -1; col <= 24; col++) {
          const points = [corner(col,row), corner(col+1,row), corner(col+1,row+1), corner(col,row+1)];
          const center = points.reduce((a,p) => [a[0]+p[0]/4,a[1]+p[1]/4], [0,0]);
          const inset = points.map(p => p.map((v,i) => center[i]+(v-center[i])*.9));
          const mids = inset.map((p,i) => p.map((v,j) => (v+inset[(i+1)%4][j])/2));
          let d = `M${mids[3].join(' ')}`;
          for (let i=0;i<4;i++) d += `Q${inset[i].join(' ')} ${mids[i].join(' ')}`;
          cells[Math.floor(roll()*4)] += d+'Z';
          grainGlints += `M${mids[3].join(' ')}Q${inset[0].join(' ')} ${mids[0].join(' ')}`;
        }
      }
      cells.forEach((d,i) => grain.append(svgNode('path', { d, fill: '#fff', opacity: .04+i*.02 })));
      grain.append(svgNode('path', { d: grainGlints, fill: 'none', stroke: '#fff', 'stroke-width': .3, opacity: .07 }));
      defs.append(grain); cover(`url(#${id}-grain)`);
      lighting('leather-sheen', [[0, '#fff', 0], [.3, '#fff', .02], [.5, '#fff', .07], [.7, '#fff', .02], [1, '#fff', 0]]);
    } else if (attribute.texture === 'carbon-fiber') {
      lighting('carbon-base', [[0, '#000', .35], [.3, '#000', .18], [.5, '#fff', .25], [1, '#000', .45]], true);
      // Tight woven 2x2 checker pattern with alternating reflective strands
      const carbon = svgNode('pattern', { id: id + '-twill', patternUnits: 'userSpaceOnUse', width: 36, height: 36 });
      for (const [bx, by, horiz] of [[0, 0, true], [18, 18, true], [18, 0, false], [0, 18, false]]) {
        carbon.append(svgNode('rect', {
          x: bx, y: by, width: 18, height: 18,
          fill: '#000000', 'fill-opacity': horiz ? 0.38 : 0.58
        }));
        for (let s = 0; s < 6; s++) {
          const pos = s * 3 + 1.5;
          if (horiz) {
            carbon.append(svgNode('line', {
              x1: bx, y1: by + pos, x2: bx + 18, y2: by + pos,
              stroke: s % 2 ? '#ffffff' : '#000000', 'stroke-width': 0.8,
              opacity: s % 2 ? 0.38 : 0.22
            }));
          } else {
            carbon.append(svgNode('line', {
              x1: bx + pos, y1: by, x2: bx + pos, y2: by + 18,
              stroke: s % 2 ? '#ffffff' : '#000000', 'stroke-width': 0.8,
              opacity: s % 2 ? 0.18 : 0.14
            }));
          }
        }
      }
      defs.append(carbon); cover(`url(#${id}-twill)`);
      lighting('carbon-flash-a', [[0, '#fff', 0], [.38, '#fff', 0], [.46, '#fff', .65], [.5, '#fff', .1], [1, '#fff', 0]]);
      lighting('carbon-flash-b', [[0, '#fff', 0], [.52, '#fff', 0], [.6, '#fff', .45], [.66, '#fff', .08], [1, '#fff', 0]]);
    } else if (attribute.texture === 'denim') {
      lighting('denim-diffuse', [[0, '#fff', .06], [.5, '#000', .02], [1, '#000', .16]], true);
      const twill = svgNode('pattern', { id: id + '-denim', patternUnits: 'userSpaceOnUse', width: 32, height: 32 });
      // Three colored warp crossings to one pale weft crossing, offset each row.
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const weft = (x + y) % 4 === 0;
          twill.append(svgNode('path', {
            d: weft ? `M${x*2+.2} ${y*2+1}h1.6` : `M${x*2+1} ${y*2+.15}v1.7`,
            stroke: weft ? '#fff' : (x % 3 ? '#000' : '#fff'),
            'stroke-width': weft ? .65 : .8, 'stroke-linecap': 'round',
            opacity: weft ? .14 + roll() * .08 : .035 + roll() * .055
          }));
        }
      }
      defs.append(twill); cover(`url(#${id}-denim)`);
    } else if (attribute.texture === 'bubbled') {
      lighting('bubble-depth', [[0,'#fff',.08],[.5,'#fff',0],[1,'#000',.18]], true);
      const film=svgNode('radialGradient',{id:id+'-film',cx:'45%',cy:'42%',r:'58%'});
      for(const [offset,color,opacity] of [[0,'#fff',0],[.65,'#fff',.015],[.83,'#000',.13],[.94,'#c7d8e4',.25],[1,'#000',.12]])
        film.append(svgNode('stop',{offset,'stop-color':color,'stop-opacity':opacity}));
      const glint=svgNode('radialGradient',{id:id+'-glint'});
      for(const [offset,opacity] of [[0,.8],[.35,.5],[.72,.12],[1,0]]) glint.append(svgNode('stop',{offset,'stop-color':'#fff','stop-opacity':opacity}));
      defs.append(film,glint);
      const reflection = svgNode('g', { id: id+'-reflection' });
      reflection.append(svgNode('ellipse', { cx: -.3, cy: -.45, rx: .32, ry: .13, transform:'rotate(-30 -.3 -.45)', fill:`url(#${id}-glint)` }));
      defs.append(reflection);
      if (effects) effects.push((x,y) => {
        reflection.setAttribute('transform', `translate(${x*.28} ${y*.28}) rotate(${x*18-y*12})`);
        film.setAttribute('cx', `${45+x*15}%`); film.setAttribute('cy', `${42+y*15}%`);
      });
      const bubbles=[];
      for(let i=0;i<180;i++) {
        const x=-150+roll()*660,y=-150+roll()*660,r=7+roll()**2*40;
        if(bubbles.some(b=>Math.hypot(x-b.x,y-b.y)<(r+b.r)*.83))continue;
        bubbles.push({x,y,r});
        pattern.append(svgNode('circle',{cx:x,cy:y,r,fill:`url(#${id}-film)`}));
        pattern.append(svgNode('use', { href: `#${id}-reflection`, transform: `translate(${x} ${y}) scale(${r})`, opacity: .6 }));
      }
    } else if (attribute.texture === 'lava') {
      lighting('basalt-crust', [[0, '#000', .08], [.5, '#000', .16], [1, '#000', .25]], true);
      const heat=svgNode('radialGradient',{id:id+'-heat'});
      for(const [offset,color,opacity] of [[0,'#ffd16c',.95],[.25,'#ff9c20',.9],[.5,'#ec3a04',.65],[1,'#b72304',0]])
        heat.append(svgNode('stop',{offset,'stop-color':color,'stop-opacity':opacity}));
      defs.append(heat);
      // Dark volcanic crust plates separated by glowing incandescent magma rivers
      const seeds = [];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        seeds.push([-180 + (x + 0.2 + roll() * 0.6) * 90, -180 + (y + 0.2 + roll() * 0.6) * 90]);
      }
      for (let s = 0; s < seeds.length; s++) {
        const seed = seeds[s];
        let cell = [[-180, -180], [540, -180], [540, 540], [-180, 540]];
        for (const other of seeds) {
          if (other === seed || !cell.length) continue;
          const nx = other[0] - seed[0], ny = other[1] - seed[1];
          const limit = (other[0] ** 2 + other[1] ** 2 - seed[0] ** 2 - seed[1] ** 2) / 2;
          const clipped = [];
          for (let i = 0; i < cell.length; i++) {
            const a = cell[i], b = cell[(i + 1) % cell.length];
            const da = a[0] * nx + a[1] * ny - limit, db = b[0] * nx + b[1] * ny - limit;
            if (da <= 0) clipped.push(a);
            if ((da <= 0) !== (db <= 0)) {
              const t = da / (da - db);
              clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            }
          }
          cell = clipped;
        }
        if (!cell.length) continue;
        const edge=[];
        for(let k=0;k<cell.length;k++) {
          const a=cell[k],b=cell[(k+1)%cell.length],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/4);
          for(let j=0;j<n;j++) {
            const x=a[0]+(b[0]-a[0])*j/n,y=a[1]+(b[1]-a[1])*j/n;
            edge.push([x+4*Math.sin(y*.12)+1.6*Math.sin(y*.57),y+3*Math.sin(x*.15)+1.1*Math.sin(x*.63)]);
          }
        }
        const pts=edge.map(p=>p.join(',')).join(' ');
        pattern.append(svgNode('polygon', {
          points: pts,
          fill: '#000000',
          'fill-opacity': s % 3 ? 0.22 : 0.12,
          stroke: '#9e230b', 'stroke-width': 10+roll()*5, 'stroke-opacity': .8,
          'stroke-linejoin': 'round'
        }));
        pattern.append(svgNode('polygon', {
          points: pts,
          fill: 'none',
          stroke: '#f45b0b', 'stroke-width': 3+roll()*4, 'stroke-opacity': .95,
          'stroke-linejoin': 'round'
        }));
        pattern.append(svgNode('polygon', {
          points: pts,
          fill: 'none',
          stroke: '#ffc34e', 'stroke-width': .6+roll()*1.3, 'stroke-opacity': .65+roll()*.3,
          'stroke-linejoin': 'round'
        }));
      }
      // Local melt pockets widen some junctions instead of heating every edge equally.
      for(let i=0;i<seeds.length;i+=3) {
        const [x,y]=seeds[i];
        // Find a nearby cell boundary midway to the nearest other seed.
        let other=null,distance=Infinity;
        for(const candidate of seeds) if(candidate!==seeds[i]) {
          const d=Math.hypot(candidate[0]-x,candidate[1]-y);
          if(d<distance){distance=d;other=candidate;}
        }
        const px=(x+other[0])/2,py=(y+other[1])/2;
        pattern.append(svgNode('ellipse',{cx:px+4*Math.sin(py*.12)+1.6*Math.sin(py*.57),cy:py+3*Math.sin(px*.15)+1.1*Math.sin(px*.63),
          rx:5+roll()*9,ry:4+roll()*6,fill:`url(#${id}-heat)`}));
      }
      const crust=svgNode('pattern',{id:id+'-crust',patternUnits:'userSpaceOnUse',width:96,height:96});
      const dust=['','',''];
      for(let i=0;i<1300;i++) {
        const x=roll()*96,y=roll()*96,r=.3+roll()*1.6;
        dust[i%3]+=`M${x} ${y}l${r} ${-r*.4}l${r*.5} ${r}l${-r} ${r*.4}Z`;
      }
      dust.forEach((d,i)=>crust.append(svgNode('path',{d,fill:i?'#000':'#b3a09a',opacity:i?.2:.14})));
      defs.append(crust);cover(`url(#${id}-crust)`);
    } else if (attribute.texture === 'circuitry') {
      lighting('pcb-substrate', [[0,'#fff',.025],[.5,'#000',.04],[1,'#000',.16]], true);
      const board=svgNode('pattern',{id:id+'-board',patternUnits:'userSpaceOnUse',width:360,height:360});
      // Irregular component footprints and locally routed buses, with muted metal.
      for(let row=0;row<7;row++) for(let col=0;col<7;col++) {
        const x=col*52+5+roll()*10,y=row*52+5+roll()*10,w=9+roll()*14,h=8+roll()*18;
        const cell=svgNode('g',{transform:`translate(${x} ${y}) rotate(${Math.floor(roll()*4)*90} 18 18)`});
        for(let pin=0;pin<5;pin++) {
          const py=3+pin*3.5, run=8+roll()*13, step=4+Math.floor(roll()*4)*3;
          const d=`M${w} ${py}h${run}l${step} ${step}v${10+roll()*16}`;
          cell.append(svgNode('path',{d,fill:'none',stroke:'#111513','stroke-width':1.8,opacity:.5}),
            svgNode('path',{d,fill:'none',stroke:pin%3?'#958b70':'#b7b9ad','stroke-width':.6,opacity:.6}),
            svgNode('circle',{cx:w+run+step,cy:py+step+10,r:1,fill:'#171b18',stroke:'#a49b80','stroke-width':.5}));
        }
        cell.append(svgNode('rect',{x:0,y:0,width:w,height:h,rx:.8,fill:'#1a1c1c',stroke:'#888b80','stroke-width':.55}));
        for(let pin=2;pin<h-1;pin+=3)cell.append(svgNode('path',{d:`M-3 ${pin}h3M${w} ${pin}h3`,stroke:'#b1ae99','stroke-width':1.2}));
        cell.append(svgNode('path',{d:`M2 2h${w-4}`,stroke:'#c7c7b4','stroke-width':.5,opacity:.35}));
        for(let j=0;j<3;j++) {
          const px=roll()*35,py=h+5+j*5;
          cell.append(svgNode('rect',{x:px,y:py,width:4+roll()*4,height:2,fill:j%2?'#777469':'#292c29',stroke:'#c2b9a1','stroke-width':.4}));
        }
        board.append(cell);
      }
      defs.append(board);cover(`url(#${id}-board)`);
      lighting('pcb-sheen', [[0,'#fff',.07],[.5,'#fff',.015],[1,'#fff',0]], true);
    } else if (attribute.texture === 'liquid') {
      lighting('liquid-depth', [[0,'#fff',.12],[.4,'#000',.02],[1,'#000',.3]], true);
      // Sample one periodic wave surface; shared normals produce connected reflections.
      const ripples=svgNode('pattern',{id:id+'-ripples',patternUnits:'userSpaceOnUse',width:360,height:360});
      const shades=Array.from({length:32},()=> '');
      const tau=Math.PI*2;
      for(let y=0;y<360;y+=2) for(let x=0;x<360;x+=2) {
        let dx=0,dy=0,height=0;
        for(const [kx,ky,amplitude,phase] of [[2,1,1.4,.3],[1,3,.9,1.3],[4,-2,.6,2.1],[9,3,.25,.6],[13,-7,.12,1.8]]) {
          const wx=x+18*Math.sin(tau*y/180)+9*Math.sin(tau*x/120);
          const wy=y+24*Math.sin(tau*x/360)+7*Math.cos(tau*y/90);
          const wave=tau*(kx*wx+ky*wy)/360+phase;
          height+=amplitude*Math.sin(wave);
          const c=amplitude*Math.cos(wave)*tau/360;
          dx+=kx*c;dy+=ky*c;
        }
        const length=Math.hypot(dx,dy,1);
        const spec=Math.pow(Math.max(0,(-dx*.12+dy*.45+.885)/length),64);
        const tone=Math.max(0,Math.min(31,Math.round(8+spec*12+Math.exp(-height*height*2)*18-(dx+dy)*6)));
        shades[tone]+=`M${x} ${y}h2v2h-2Z`;
      }
      const soften=svgNode('filter',{id:id+'-ripple-soften',x:'-5%',y:'-5%',width:'110%',height:'110%'});
      soften.append(svgNode('feGaussianBlur',{stdDeviation:.35}));defs.append(soften);
      const waterSurface=svgNode('g',{filter:`url(#${id}-ripple-soften)`});
      shades.forEach((d,i)=>waterSurface.append(svgNode('path',{d,fill:i<9?'#000':'#fff',opacity:i<9?(9-i)*.025:(i-9)*.035})));
      ripples.append(waterSurface);
      defs.append(ripples);cover(`url(#${id}-ripples)`);
      animate((x,y,time) => ripples.setAttribute('patternTransform', `translate(${Math.sin(time*.22)*7+x*3} ${Math.cos(time*.17)*9+y*3}) scale(${1+Math.sin(time*.19)*.025} ${1+Math.cos(time*.23)*.025})`));
      lighting('liquid-reflection',[[0,'#fff',.03],[.4,'#fff',.13],[.7,'#fff',.02],[1,'#fff',0]],true);

    }
    if (['crackle', 'hammered-metal'].includes(attribute.texture)) {
      const frozen = svgNode('svg', { xmlns: NS, viewBox: '-180 -180 720 720', width:720, height:720 });
      const localDefs = svgNode('defs');
      for (const node of defs.children) if ((node.getAttribute('id') || '').startsWith(id+'-')) localDefs.append(node.cloneNode(true));
      frozen.append(localDefs);
      for (const node of [...pattern.children]) if (!lightLayers.includes(node)) frozen.append(node);
      const image = svgNode('image', { x:-180,y:-180,width:720,height:720,
        href: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(frozen)) });
      pattern.replaceChildren(image, ...lightLayers);
      // Rasterize the immutable detail once. A nested vector image alone still
      // rerasterizes thousands of crack segments during gradient updates.
      const source = new Image();
      source.onload = () => {
        if (!image.isConnected) return;
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 720;
        const context = canvas.getContext('2d');
        context.drawImage(source, 0, 0, 720, 720);
        image.setAttribute('href', canvas.toDataURL('image/png'));
      };
      source.src = image.getAttribute('href');
    }
    defs.append(pattern);
    return `url(#${id})`;
  }
  function sandstoneEdge(defs, id) {
    const grain = svgNode('pattern', { id, patternUnits: 'userSpaceOnUse', width: 48, height: 48 });
    let state = 317;
    const roll = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    // Angular exposed grains and dark pores within the existing silhouette.
    for (let i=0;i<260;i++) {
      const x=roll()*48, y=roll()*48, r=.35+roll()*1.35;
      grain.append(svgNode('path', { d:`M${x} ${y-r}l${r} ${r*.8}l${-r*.45} ${r}l${-r*1.2} ${-r*.35}Z`,
        fill:i%3 ? '#000' : '#fff', opacity:.12+roll()*.28 }));
    }
    defs.append(grain);
    return `url(#${id})`;
  }
  function materialEdge(defs, face, shapes, attribute, id, effects, seamContours = shapes) {
    if (['denim', 'leather', 'plush', 'velvet'].includes(attribute.texture)) {
      const plush = attribute.texture === 'plush', velvet = attribute.texture === 'velvet', leather = attribute.texture === 'leather';
      // Erode the union, so the joined eyes have no seam through their overlap.
      // Clip dashed boundary strokes to two inset bands; tiny pupils get a hem only.
      const small = shapes.every(shape => Number(shape.getAttribute('r')) > 0 && Number(shape.getAttribute('r')) <= 17);
      for (const [index, inner, outer] of [[0, 0, plush ? 3 : 2], ...(!small && !velvet ? (plush ? [[1, 2, 6]] : leather ? [[1, 3, 4.5]] : [[1, 3, 4], [2, 6, 7]]) : [])]) {
        const key = `${id}-seam-${index}`;
        const filter = svgNode('filter', { id: key, filterUnits: 'userSpaceOnUse', x: 0, y: 0, width: 360, height: 360 });
        filter.append(svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: inner, result: 'outer' }),
          svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: outer, result: 'inner' }),
          svgNode('feComposite', { in: 'outer', in2: 'inner', operator: 'out' }));
        const mask = svgNode('mask', { id: key + '-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 360, height: 360,
          style: 'mask-type:alpha' });
        const union = svgNode('g', { fill: '#fff', filter: `url(#${key})` });
        for (const shape of shapes) union.append(shape.cloneNode(true));
        mask.append(union); defs.append(filter, mask);
        const seam = svgNode('g', { mask: `url(#${key}-mask)`, opacity: index ? (plush ? .85 : .65) : (velvet || plush ? .12 : .2) });
        if (!index) {
          seam.append(svgNode('rect', { width: 360, height: 360, fill: '#000' }));
          if (velvet || plush) {
            const fuzz=svgNode('pattern',{id:key+'-fuzz',patternUnits:'userSpaceOnUse',width:8,height:8});
            fuzz.append(svgNode('path',{d:'M0 1l2 1M4 0l-1 3M7 3l-2 2M1 6l2-1M5 7l2 1',stroke:'#fff','stroke-width':plush?1.2:.65,'stroke-linecap':'round'}));
            defs.append(fuzz);seam.setAttribute('opacity',.38);
            seam.append(svgNode('rect',{width:360,height:360,fill:`url(#${key}-fuzz)`}));
          }
        }
        else for (const shape of seamContours) {
          const stitch = shape.cloneNode(true);
          stitch.setAttribute('fill', 'none');
          stitch.setAttribute('stroke', plush ? '#d8caba' : leather ? '#b8a58a' : '#c6a36d');
          stitch.setAttribute('stroke-width', 16);
          stitch.setAttribute('stroke-dasharray', plush ? '2 5' : leather ? '2.5 2.5' : '3 3');
          stitch.setAttribute('stroke-linecap', 'round');
          seam.append(stitch);
        }
        face.append(seam);
      }
      return;
    }
    // Erode the combined silhouette so overlapping eyes never acquire an internal seam.
    const finishes = {
      terrazzo: { width: 1.6, rim: .4, stops: [[0, '#fff', .4], [.5, '#fff', .06], [1, '#000', .22]] },
      crackle: { width: 2, rim: .6, stops: [[0, '#fff', .55], [.45, '#fff', .12], [1, '#000', .28]] },
      opalescent: { width: 2.6, rim: .7, stops: [[0, '#fff0da', .65], [.35, '#d3f9ee', .45], [.7, '#e7dfff', .35], [1, '#000', .2]] },
      frosted: { width: 2.8, rim: .7, stops: [[0, '#fff', .65], [.5, '#fff', .28], [1, '#fff', .12]] },
      woodgrain: { width: 1.5, rim: .4, stops: [[0, '#fff', .3], [.45, '#fff', .06], [1, '#000', .25]] },
      holographic: { width: 2, rim: .65, stops: [[0, '#b8ffff', .8], [.3, '#ffc9f6', .65], [.6, '#fff2af', .65], [1, '#94bcff', .6]] },
      pearlescent: { width: 2.5, rim: .7, stops: [[0, '#fff4e4', .65], [.4, '#e3efff', .25], [1, '#000', .2]] },
      marble: { width: 1.8, rim: .5, stops: [[0, '#fff', .45], [.5, '#fff', .08], [1, '#000', .2]] },
      lacquered: { width: 3.2, rim: 1, stops: [[0, '#fff', .85], [.32, '#fff', .3], [.5, '#000', .15], [1, '#000', .5]] },
      metallic: { width: 2.4, rim: .65, stops: [[0, '#fff', .85], [.43, '#fff', .12], [.49, '#000', .55], [.56, '#fff', .65], [1, '#000', .6]] },
      glossy: { width: 3.4, rim: 1.1, stops: [[0, '#fff', .65], [.35, '#fff', .24], [.65, '#fff', .02], [1, '#000', .28]] },
      iridescent: { width: 2.5, rim: .7, stops: [[0, '#82fff0', .8], [.28, '#aaa1ff', .65], [.5, '#ff8cdb', .55], [.72, '#ffe6a0', .6], [1, '#53bfff', .7]] },
      crystalline: { width: 2, rim: .45, stops: [[0, '#fff', .9], [.24, '#fff', .55], [.25, '#000', .32], [.49, '#000', .12], [.5, '#fff', .8], [.74, '#fff', .2], [.75, '#000', .42], [1, '#000', .55]] },
      granite: { width: 4, rim: .75, stops: [[0, '#fff', .85], [.42, '#fff', .5], [.49, '#fff', .22], [.5, '#000', .35], [1, '#000', .8]] },
      satin: { width: 1.2, rim: .3, stops: [[0, '#fff', .22], [.3, '#fff', .06], [.55, '#fff', .02], [1, '#000', .12]] },
      sandstone: { width: 3.2, rim: .7, stops: [[0, '#fff', .22], [.5, '#fff', .04], [1, '#000', .3]] },
      starfield: { width: 2.6, rim: .7, stops: [[0, '#d1e8ff', .6], [.35, '#e0b8ff', .35], [.7, '#0f0524', .5], [1, '#000', .7]] },
      quartz: { width: 2.2, rim: .5, stops: [[0, '#fff', .92], [.22, '#fff', .6], [.24, '#000', .28], [.48, '#fff', .82], [.72, '#fff', .25], [.74, '#000', .38], [1, '#000', .55]] },
      obsidian: { width: 3.2, rim: 1, stops: [[0, '#fff', .9], [.2, '#fff', .15], [.6, '#000', .35], [1, '#000', .7]] },
      mosaic: { width: 2.2, rim: .55, stops: [[0, '#fff', .55], [.45, '#fff', .1], [1, '#000', .3]] },
      'hammered-metal': { width: 2.6, rim: .7, stops: [[0, '#fff', .88], [.38, '#fff', .18], [.45, '#000', .5], [.52, '#fff', .7], [1, '#000', .6]] },
      kintsugi: { width: 2, rim: .55, stops: [[0, '#fff', .4], [.35, '#fff', .12], [.65, '#000', .12], [1, '#000', .3]] },
      leather: { width: 1.5, rim: .4, stops: [[0, '#fff', .2], [.35, '#fff', .04], [.7, '#000', .14], [1, '#000', .3]] },
      'carbon-fiber': { width: 2.6, rim: .7, stops: [[0, '#fff', .85], [.3, '#000', .5], [.6, '#fff', .65], [1, '#000', .7]] },
      denim: { width: 1.8, rim: .4, stops: [[0, '#fff', .35], [.5, '#fff', .05], [1, '#000', .3]] },
      bubbled: { width: 2.8, rim: .8, stops: [[0, '#fff', .85], [.3, '#d4f8ff', .4], [.6, '#ffd6f5', .25], [1, '#000', .35]] },
      lava: { width: 2.5, rim: .6, stops: [[0, '#ff9900', .9], [.35, '#ff3300', .6], [.65, '#3a0800', .7], [1, '#110000', .85]] },
      circuitry: { width: 1.3, rim: .35, stops: [[0, '#fff', .25], [.3, '#a4a69b', .2], [.6, '#000', .16], [1, '#000', .4]] },
      liquid: { width: 3.2, rim: 1, stops: [[0, '#fff', .9], [.25, '#fff', .35], [.55, '#fff', .05], [1, '#000', .4]] }
    };
    const finish = finishes[attribute.texture];
    if (!finish) return;
    const gradient = svgNode('linearGradient', { id: id + '-light', gradientUnits: 'userSpaceOnUse',
      x1: 30, y1: 20, x2: 330, y2: 340, gradientTransform: `rotate(${attribute.angle} 180 180)` });
    for (const [offset, color, opacity] of finish.stops) gradient.append(svgNode('stop', {
      offset, 'stop-color': color, 'stop-opacity': opacity
    }));
    defs.append(gradient);
    if (effects) effects.push((x, y) => gradient.setAttribute('gradientTransform',
      `translate(${x * 38} ${y * 38}) rotate(${attribute.angle} 180 180)`));
    const crumbs = attribute.texture === 'sandstone' ? sandstoneEdge(defs, id+'-crumbs') : null;
    for (const [index, width] of [finish.width, finish.rim].entries()) {
      const key = id + '-' + index;
      const filter = svgNode('filter', { id: key + '-cut', filterUnits: 'userSpaceOnUse',
        x: 0, y: 0, width: 360, height: 360, 'color-interpolation-filters': 'sRGB' });
      filter.append(svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: width, result: 'inset' }));
      if (crumbs) filter.append(
        svgNode('feTurbulence', { type:'fractalNoise', baseFrequency:.28, numOctaves:2, seed:317, result:'grain' }),
        svgNode('feDisplacementMap', { in:'inset', in2:'grain', scale:index ? 1.4 : 4, xChannelSelector:'R', yChannelSelector:'G', result:'inset' }));
      filter.append(svgNode('feComposite', { in: 'SourceGraphic', in2: 'inset', operator: 'out' }));
      const mask = svgNode('mask', { id: key + '-mask', maskUnits: 'userSpaceOnUse',
        maskContentUnits: 'userSpaceOnUse', x: 0, y: 0, width: 360, height: 360 });
      const silhouette = svgNode('g', { fill: '#fff', filter: `url(#${key}-cut)` });
      for (const shape of shapes) silhouette.append(shape.cloneNode(true));
      mask.append(silhouette); defs.append(filter, mask);
      face.append(svgNode('rect', { width: 360, height: 360, fill: `url(#${id}-light)`,
        mask: `url(#${key}-mask)`, opacity: index ? .8 : attribute.texture === 'granite' ? .68 : .38 }));
      if (crumbs && !index) face.append(svgNode('rect', { width:360, height:360, fill:crumbs, mask:`url(#${key}-mask)` }));
    }
  }
  function enamelMetal(defs, prefix, grade, effects) {
    // Match the card lettering's grade palette; ordinary grades use satin nickel.
    const palettes = {
      S: [[0, '#fff0d4'], [.34, '#ffc885'], [.48, '#ae6331'], [.52, '#ffe0ad'], [.8, '#ff9954'], [1, '#ffe0ad']],
      'S+': [[0, '#fff3dd'], [.38, '#ffbd89'], [.48, '#aa4f54'], [.51, '#ffe3cf'], [.76, '#ff8dac'], [1, '#ffc48b']],
      U: [[0, '#ffda65'], [.16, '#c350f2'], [.28, '#6431bd'], [.38, '#fff3cf'], [.58, '#ff54b7'], [.82, '#ffc94f'], [1, '#fff3cf']],
      UBU: [[0, '#ffda65'], [.16, '#c350f2'], [.28, '#6431bd'], [.38, '#fff3cf'], [.58, '#ff54b7'], [.82, '#ffc94f'], [1, '#fff3cf']]
    };
    const id = prefix + '-metal';
    const gradient = svgNode('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: 15, y1: 0, x2: 345, y2: 360 });
    for (const [offset, color] of palettes[grade] || [[0, '#f3eee4'], [.25, '#b7b7b2'], [.46, '#727679'], [.5, '#fff8e9'], [.65, '#bfc1be'], [1, '#73787c']]) {
      gradient.append(svgNode('stop', { offset, 'stop-color': color }));
    }
    defs.append(gradient);
    effects.push((x, y) => gradient.setAttribute('gradientTransform', `translate(${x * 35} ${y * 35}) rotate(${x * 12 - y * 8} 180 180)`));
    return `url(#${id})`;
  }
  function enamelDivider(defs, face, shapes, id, metal) {
    // Erode the filled union, including lid clips and mouth holes. No seam
    // appears inside overlapping eyes, and later layers hide covered borders.
    const filter = svgNode('filter', { id, filterUnits: 'userSpaceOnUse', x: 0, y: 0, width: 360, height: 360 });
    filter.append(svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: 1.25, result: 'inside' }),
      svgNode('feComposite', { in: 'SourceAlpha', in2: 'inside', operator: 'out' }));
    const mask = svgNode('mask', { id: id + '-mask', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 360, height: 360, style: 'mask-type:alpha' });
    const union = svgNode('g', { fill: '#fff', filter: `url(#${id})` });
    for (const shape of shapes) union.append(shape.cloneNode(true));
    mask.append(union); defs.append(filter, mask);
    face.append(svgNode('rect', { width: 360, height: 360, fill: metal, mask: `url(#${id}-mask)` }));
  }
  function renderSVG(m, className = 'oomark', surface = null, extraEffects = null, enamel = false) {
    const effects = className === 'oomark' || enamel ? (extraEffects || []) : null;
    const prefix = 'ubu-' + (++serial);
    const svg = svgNode('svg', { class: className, viewBox: '0 0 360 360', role: 'img', 'aria-label': `${m.parts.fullName}, Ubuquity ${m.grade}` });
    const title = svgNode('title'); title.textContent = `${m.parts.fullName} · ${m.grade}`;
    const defs = svgNode('defs');
    const bounds = svgNode('clipPath', { id: prefix + '-bounds', clipPathUnits: 'userSpaceOnUse' });
    bounds.append(svgNode('circle', { cx: 180, cy: 180, r: 176 })); defs.append(bounds);
    const face = svgNode('g', { 'clip-path': `url(#${prefix}-bounds)` });
    svg.append(title, defs, face);
    const metal = enamel ? enamelMetal(defs, prefix, m.grade, effects) : null;
    if (enamel) {
      svg.setAttribute('viewBox', '-12 -12 384 404');
      // The back is offset downwards to expose a shallow metal sidewall.
      const body = svgNode('g');
      body.append(svgNode('circle', { cx: 180, cy: 187, r: 181, fill: metal }),
        svgNode('circle', { cx: 180, cy: 187, r: 181, fill: '#000', opacity: .3 }),
        svgNode('circle', { cx: 180, cy: 180, r: 181, fill: metal, stroke: '#fff', 'stroke-opacity': .3, 'stroke-width': .7 }));
      svg.insertBefore(body, face);
    }
    const eyePositions = [[120.55, 145.5, m.eyes.left], [239.44, 145.5, m.eyes.right]];
    const eyeShapes = eyePositions.map(([cx, cy, eye], i) => {
      const shape = svgNode('circle', { cx, cy, r: 66.05 });
      if (!eye.planes.length) return shape;
      const id = prefix + '-lid-' + i;
      const clip = svgNode('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
      clip.append(svgNode('polygon', { points: ubu.eyePolygon(eye).map(([x, y]) => `${cx + x},${cy + y}`).join(' ') }));
      defs.append(clip);
      shape.setAttribute('clip-path', `url(#${id})`);
      return shape;
    });
    const shapes = {
      background: [svgNode('circle', { cx: 180, cy: 180, r: 176 })],
      eyes: eyeShapes,
      irises: eyePositions.map(([x, y, eye]) => svgNode('circle', { cx: x + eye.dx, cy: y + eye.dy, r: 30.7126 })),
      pupils: eyePositions.map(([x, y, eye]) => svgNode('circle', { cx: x + eye.dx, cy: y + eye.dy, r: 17 })),
      mouth: [svgNode('path', { d: ubu.mouthPath(m.mouth) })]
    };
    let matteFill;
    for (const role of roles) {
      const attribute = m.attributes[role];
      const layer = svgNode('g', { fill: attribute.hex });
      layer.append(...shapes[role]); face.append(layer);
      const clipId = prefix + '-' + role + '-clip';
      const clip = svgNode('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
      for (const shape of shapes[role]) clip.append(shape.cloneNode(true));
      defs.append(clip);
      const designed = ['metallic', 'glossy', 'iridescent', 'crystalline', 'pearlescent', 'damascus', 'marble', 'lacquered',
        'velvet', 'frosted', 'woodgrain', 'holographic', 'terrazzo', 'crackle', 'plush', 'opalescent', 'granite', 'satin', 'sandstone', 'starfield', 'quartz', 'obsidian', 'mosaic', 'hammered-metal', 'kintsugi', 'leather', 'carbon-fiber', 'denim', 'bubbled', 'lava', 'circuitry', 'liquid'].includes(attribute.texture);
      const fill = designed
        ? material(defs, attribute, prefix + '-' + role + '-texture', effects)
        : (matteFill ||= material(defs, { texture: 'matte', angle: 0 }, prefix + '-matte', effects));
      face.append(svgNode('rect', { x: 0, y: 0, width: 360, height: 360, fill, 'clip-path': `url(#${clipId})` }));
      if (enamel) {
        if (role !== 'background') enamelDivider(defs, face, shapes[role], prefix + '-divider-' + role, metal);
      } else if (designed) {
        const contours = [...shapes[role]];
        if (role === 'eyes' && ['denim','leather','plush'].includes(attribute.texture)) {
          for (const [cx, cy, eye] of eyePositions) if (eye.planes.length) {
            // The union mask trims these lid contours to the actual eye boundary.
            contours.push(svgNode('polygon', { points: ubu.eyePolygon(eye).map(([x, y]) => `${cx+x},${cy+y}`).join(' ') }));
          }
        }
        materialEdge(defs, face, shapes[role], attribute, prefix + '-' + role + '-edge', effects, contours);
      }
    }
    if (enamel) {
      const coatId = prefix + '-enamel-coat';
      const coat = svgNode('linearGradient', { id: coatId, gradientUnits: 'userSpaceOnUse', x1: 35, y1: 0, x2: 300, y2: 360 });
      for (const [offset, opacity] of [[0, .22], [.22, .05], [.35, .02], [.43, .16], [.5, .025], [.8, 0], [1, .08]]) {
        coat.append(svgNode('stop', { offset, 'stop-color': '#fff', 'stop-opacity': opacity }));
      }
      defs.append(coat);
      face.append(svgNode('circle', { cx: 180, cy: 180, r: 176, fill: `url(#${coatId})`, 'pointer-events': 'none' }),
        svgNode('circle', { cx: 180, cy: 180, r: 175.5, fill: 'none', stroke: '#000', 'stroke-opacity': .28, 'stroke-width': 1 }));
      effects.push((x, y) => coat.setAttribute('gradientTransform', `translate(${x * 25} ${y * 25})`));
      attachLighting(svg, effects, surface || svg);
      return svg;
    }
    // Keep the front flat; only the narrow perimeter rolls into the token edge.
    // This overlays the complete face without changing any DNA-derived paths.
    const edgeId = prefix + '-token-edge';
    const edge = svgNode('radialGradient', { id: edgeId, gradientUnits: 'userSpaceOnUse', cx: 178, cy: 176, r: 180 });
    edge.append(
      svgNode('stop', { offset: '0%', 'stop-color': '#000', 'stop-opacity': 0 }),
      svgNode('stop', { offset: '94%', 'stop-color': '#000', 'stop-opacity': 0 }),
      svgNode('stop', { offset: '98%', 'stop-color': '#000', 'stop-opacity': .13 }),
      svgNode('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': .32 })
    );
    const rimId = prefix + '-token-rim';
    const rim = svgNode('linearGradient', { id: rimId, x1: 0, y1: 0, x2: 1, y2: 1 });
    for (const [offset, color, opacity] of [[0, '#fff', .44], [.4, '#fff', .07], [.65, '#000', .06], [1, '#000', .28]]) {
      rim.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
    }
    defs.append(edge, rim);
    face.append(svgNode('circle', { cx: 180, cy: 180, r: 176, fill: `url(#${edgeId})`, 'pointer-events': 'none' }),
      svgNode('circle', { cx: 180, cy: 180, r: 174.5, fill: 'none', stroke: `url(#${rimId})`, 'stroke-width': ['velvet','plush'].includes(m.attributes.background.texture) ? 0 : 3, 'pointer-events': 'none' }));
    if (effects) {
      effects.push((x, y) => {
        rim.setAttribute('x1', String(x * .15));
        rim.setAttribute('y1', String(y * .15));
      });
    }
    if (effects) attachLighting(svg, effects, surface || svg);
    return svg;
  }
  let stopLighting = () => {};
  function attachLighting(svg, effects, surface) {
    stopLighting();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, x = 0, y = 0, targetX = 0, targetY = 0, rect, lastPaint = 0;
    const idle = effects.idle || [];
    function visible() {
      const dialog = surface.closest('dialog');
      const bounds = surface.getBoundingClientRect();
      return bounds.bottom > 0 && bounds.right > 0 && bounds.top < innerHeight && bounds.left < innerWidth && surface.isConnected && !document.hidden && (!dialog || dialog.open) && surface.getClientRects().length > 0;
    }
    svg.style.filter = 'drop-shadow(0px 8px 9px #0005)';
    function paint(time) {
      frame = 0;
      if (!visible()) return;
      if (idle.length && time - lastPaint < 32) { frame = requestAnimationFrame(paint); return; }
      lastPaint = time;
      const moving = x !== targetX || y !== targetY;
      x += (targetX - x) * .18; y += (targetY - y) * .18;
      const settled = Math.abs(targetX - x) + Math.abs(targetY - y) < .001;
      if (settled) { x = targetX; y = targetY; }
      surface.style.transform = `perspective(700px) rotateX(${-y * 12}deg) rotateY(${x * 12}deg)`;
      if (surface !== svg) {
        surface.style.setProperty('--light-x', `${50 + x * 45}%`);
        surface.style.setProperty('--light-y', `${50 + y * 45}%`);
      }
      svg.style.filter = `drop-shadow(${-x * 9}px ${8 - y * 6}px 9px #0005)`;
      if (moving || reduced.matches) for (const effect of effects) effect(x, y);
      for (const effect of idle) effect(x, y, reduced.matches ? 0 : time / 1000);
      if (!settled || (idle.length && !reduced.matches)) frame = requestAnimationFrame(paint);
    }
    const schedule = () => { if (!frame && visible()) frame = requestAnimationFrame(paint); };
    function reset() { targetX = targetY = 0; schedule(); }
    function enter() { rect = surface.getBoundingClientRect(); }
    function down(event) {
      rect = surface.getBoundingClientRect();
      if (event.pointerType === 'touch') {
        try { surface.setPointerCapture(event.pointerId); } catch {}
        move(event);
      }
    }
    function move(event) {
      if (reduced.matches || !rect) return;
      if (event.pointerType === 'touch' && event.buttons === 0) return;
      targetX = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
      schedule();
    }
    function up(event) {
      if (event.pointerType === 'touch') {
        try { surface.releasePointerCapture(event.pointerId); } catch {}
        reset();
      }
    }
    function leave(event) {
      if (event.pointerType !== 'touch') reset();
    }
    function cancel(event) {
      try { surface.releasePointerCapture(event.pointerId); } catch {}
      reset();
    }
    surface.addEventListener('pointerenter', enter);
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointerleave', leave);
    surface.addEventListener('pointercancel', cancel);
    function preferenceChanged() {
      if (reduced.matches) targetX = targetY = x = y = 0;
      schedule();
    }
    // One active viewer owns idle animation. Observe dialog/tab visibility,
    // not changing SVG attributes, and never run a hidden RAF polling loop.
    const visibility = new MutationObserver(schedule);
    visibility.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['open','hidden'] });
    const intersection = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) schedule();
      else { cancelAnimationFrame(frame); frame = 0; }
    });
    intersection.observe(surface);
    document.addEventListener('visibilitychange', schedule);
    queueMicrotask(schedule);
    reduced.addEventListener('change', preferenceChanged);
    window.addEventListener('blur', reset);
    stopLighting = () => {
      cancelAnimationFrame(frame);
      visibility.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      surface.removeEventListener('pointerenter', enter);
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointermove', move);
      surface.removeEventListener('pointerup', up);
      surface.removeEventListener('pointerleave', leave);
      surface.removeEventListener('pointercancel', cancel);
      reduced.removeEventListener('change', preferenceChanged);
      window.removeEventListener('blur', reset);
    };
  }
  function renderCardMaterials(m, effects = null) {
    const CARD_ROLES = ['background', 'eyes', 'mouth', 'irises', 'pupils'];
    const layers = [];
    for (const role of CARD_ROLES) {
      const attr = m.attributes?.[role];
      if (attr?.texture && attr.texture !== 'matte') {
        layers.push({
          role,
          mat: attr,
          // Opposite angles share one stripe orientation and offset sequence.
          angle: ((attr.angle ?? 45) % 180 + 180) % 180
        });
      }
    }
    if (!layers.length) return null;

    const angleCounts = new Map();
    for (const layer of layers) {
      angleCounts.set(layer.angle, (angleCounts.get(layer.angle) || 0) + 1);
    }
    const angleIndices = new Map();
    for (const layer of layers) {
      const idx = angleIndices.get(layer.angle) || 0;
      layer.angleIndex = idx;
      layer.angleTotal = angleCounts.get(layer.angle);
      angleIndices.set(layer.angle, idx + 1);
    }

    const prefix = 'card-mat-' + (++serial);
    const svg = svgNode('svg', {
      class: 'card-materials',
      viewBox: '0 0 480 320',
      preserveAspectRatio: 'xMidYMid slice',
      'aria-hidden': 'true'
    });
    const defs = svgNode('defs');
    svg.append(defs);

    const boundsId = `${prefix}-bounds`;
    const bounds = svgNode('clipPath', { id: boundsId, clipPathUnits: 'userSpaceOnUse' });
    bounds.append(svgNode('rect', { x: 0, y: 0, width: 480, height: 320, rx: 16, ry: 16 }));
    defs.append(bounds);

    const face = svgNode('g', { 'clip-path': `url(#${boundsId})` });
    svg.append(face);

    const S = 44;
    const span = 420;
    // Keep the original generous mask bounds: some browsers clip transformed
    // masks differently when their region is tightened to the card's outline.
    const region = { x: -span, y: -span, width: span * 2 + 480, height: span * 2 + 320 };

    function getLayerRects(layer) {
      const { angleIndex, angleTotal } = layer;
      const cycle = S * 2 * angleTotal;
      const offset = angleIndex * S * 2;
      const start = -Math.ceil((span + cycle) / cycle) * cycle;
      const rects = [];
      for (let base = start; base <= span + 480; base += cycle) {
        rects.push({ x: base + offset, y: -span, width: S, height: span * 2 + 320 });
      }
      return rects;
    }

    for (let i = 0; i < layers.length; i++) {
      layers[i].rects = getLayerRects(layers[i]);
    }

    const finishes = {
      terrazzo: { width: 1.6, rim: .4, stops: [[0, '#fff', .4], [.5, '#fff', .06], [1, '#000', .22]] },
      crackle: { width: 2, rim: .6, stops: [[0, '#fff', .55], [.45, '#fff', .12], [1, '#000', .28]] },
      opalescent: { width: 2.6, rim: .7, stops: [[0, '#fff0da', .65], [.35, '#d3f9ee', .45], [.7, '#e7dfff', .35], [1, '#000', .2]] },
      frosted: { width: 2.8, rim: .7, stops: [[0, '#fff', .65], [.5, '#fff', .28], [1, '#fff', .12]] },
      woodgrain: { width: 1.5, rim: .4, stops: [[0, '#fff', .3], [.45, '#fff', .06], [1, '#000', .25]] },
      holographic: { width: 2, rim: .65, stops: [[0, '#b8ffff', .8], [.3, '#ffc9f6', .65], [.6, '#fff2af', .65], [1, '#94bcff', .6]] },
      pearlescent: { width: 2.5, rim: .7, stops: [[0, '#fff4e4', .65], [.4, '#e3efff', .25], [1, '#000', .2]] },
      marble: { width: 1.8, rim: .5, stops: [[0, '#fff', .45], [.5, '#fff', .08], [1, '#000', .2]] },
      lacquered: { width: 3.2, rim: 1, stops: [[0, '#fff', .85], [.32, '#fff', .3], [.5, '#000', .15], [1, '#000', .5]] },
      metallic: { width: 2.4, rim: .65, stops: [[0, '#fff', .85], [.43, '#fff', .12], [.49, '#000', .55], [.56, '#fff', .65], [1, '#000', .6]] },
      glossy: { width: 3.4, rim: 1.1, stops: [[0, '#fff', .65], [.35, '#fff', .24], [.65, '#fff', .02], [1, '#000', .28]] },
      iridescent: { width: 2.5, rim: .7, stops: [[0, '#82fff0', .8], [.28, '#aaa1ff', .65], [.5, '#ff8cdb', .55], [.72, '#ffe6a0', .6], [1, '#53bfff', .7]] },
      crystalline: { width: 2, rim: .45, stops: [[0, '#fff', .9], [.24, '#fff', .55], [.25, '#000', .32], [.49, '#000', .12], [.5, '#fff', .8], [.74, '#fff', .2], [.75, '#000', .42], [1, '#000', .55]] },
      granite: { width: 4, rim: .75, stops: [[0, '#fff', .85], [.42, '#fff', .5], [.49, '#fff', .22], [.5, '#000', .35], [1, '#000', .8]] },
      satin: { width: 1.2, rim: .3, stops: [[0, '#fff', .22], [.3, '#fff', .06], [.55, '#fff', .02], [1, '#000', .12]] },
      sandstone: { width: 3.2, rim: .7, stops: [[0, '#fff', .22], [.5, '#fff', .04], [1, '#000', .3]] },
      starfield: { width: 2.6, rim: .7, stops: [[0, '#d1e8ff', .6], [.35, '#e0b8ff', .35], [.7, '#0f0524', .5], [1, '#000', .7]] },
      quartz: { width: 2.2, rim: .5, stops: [[0, '#fff', .92], [.22, '#fff', .6], [.24, '#000', .28], [.48, '#fff', .82], [.72, '#fff', .25], [.74, '#000', .38], [1, '#000', .55]] },
      obsidian: { width: 3.2, rim: 1, stops: [[0, '#fff', .9], [.2, '#fff', .15], [.6, '#000', .35], [1, '#000', .7]] },
      mosaic: { width: 2.2, rim: .55, stops: [[0, '#fff', .55], [.45, '#fff', .1], [1, '#000', .3]] },
      'hammered-metal': { width: 2.6, rim: .7, stops: [[0, '#fff', .88], [.38, '#fff', .18], [.45, '#000', .5], [.52, '#fff', .7], [1, '#000', .6]] },
      kintsugi: { width: 2, rim: .55, stops: [[0, '#fff', .4], [.35, '#fff', .12], [.65, '#000', .12], [1, '#000', .3]] },
      leather: { width: 1.5, rim: .4, stops: [[0, '#fff', .2], [.35, '#fff', .04], [.7, '#000', .14], [1, '#000', .3]] },
      'carbon-fiber': { width: 2.6, rim: .7, stops: [[0, '#fff', .85], [.3, '#000', .5], [.6, '#fff', .65], [1, '#000', .7]] },
      denim: { width: 1.8, rim: .4, stops: [[0, '#fff', .35], [.5, '#fff', .05], [1, '#000', .3]] },
      bubbled: { width: 2.8, rim: .8, stops: [[0, '#fff', .85], [.3, '#d4f8ff', .4], [.6, '#ffd6f5', .25], [1, '#000', .35]] },
      lava: { width: 2.5, rim: .6, stops: [[0, '#ff9900', .9], [.35, '#ff3300', .6], [.65, '#3a0800', .7], [1, '#110000', .85]] },
      circuitry: { width: 1.3, rim: .35, stops: [[0, '#fff', .25], [.3, '#a4a69b', .2], [.6, '#000', .16], [1, '#000', .4]] },
      liquid: { width: 3.2, rim: 1, stops: [[0, '#fff', .9], [.25, '#fff', .35], [.55, '#fff', .05], [1, '#000', .4]] },
      damascus: { width: 2, rim: .5, stops: [[0, '#fff', .6], [.4, '#fff', .15], [1, '#000', .3]] },
      velvet: { width: 1.5, rim: .4, stops: [[0, '#fff', .25], [.5, '#fff', .05], [1, '#000', .2]] },
      plush: { width: 1.5, rim: .4, stops: [[0, '#fff', .25], [.5, '#fff', .05], [1, '#000', .2]] }
    };

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const { mat, angle, rects } = layer;
      const patId = `${prefix}-pat-${i}`;
      const fill = material(defs, { ...mat, angle: (mat.angle ?? 45) - angle }, patId, effects, 240, 160);

      const group = svgNode('g', {
        transform: `rotate(${angle} 240 160)`
      });

      // Mask out upper layers so lower layers are never visible beneath upper translucent stripes
      const upperLayers = layers.slice(i + 1);
      if (upperLayers.length > 0) {
        const maskId = `${prefix}-mask-${i}`;
        const mask = svgNode('mask', {
          id: maskId,
          maskUnits: 'userSpaceOnUse', ...region
        });
        mask.append(svgNode('rect', { ...region, fill: '#fff' }));
        for (const upper of upperLayers) {
          const upperGroup = svgNode('g', {
            transform: `rotate(${upper.angle - angle} 240 160)`
          });
          for (const r of upper.rects) {
            upperGroup.append(svgNode('rect', {
              x: r.x, y: r.y, width: r.width, height: r.height, fill: '#000'
            }));
          }
          mask.append(upperGroup);
        }
        defs.append(mask);
        group.setAttribute('mask', `url(#${maskId})`);
      }

      // Compound paths keep the same stripe geometry but rasterize each
      // expensive SVG material pattern once per layer, not once per stripe.
      const stripes = rects.map(r =>
        `M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}Z`).join('');
      group.append(
        svgNode('path', { d: stripes, fill: mat.hex, opacity: .65 }),
        svgNode('path', { d: stripes, fill })
      );

      const finish = finishes[mat.texture];
      if (finish) {
        const edgeId = `${prefix}-edge-${i}`;
        const gradId = `${edgeId}-light`;
        const grad = svgNode('linearGradient', {
          id: gradId, gradientUnits: 'userSpaceOnUse',
          x1: 0, y1: 0, x2: 480, y2: 0
        });
        for (const [offset, color, opacity] of finish.stops) {
          grad.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
        }
        defs.append(grad);
        if (effects) {
          effects.push((x, y) => {
            grad.setAttribute('gradientTransform', `translate(${x * 30} ${y * 30})`);
          });
        }

        // Stripe ends lie outside the card at every rotation. Inside the card,
        // eroding a rectangular stripe exposes only its two vertical edges.
        // Draw those strips directly instead of filtering/masking entire stripes.
        const crumbs = mat.texture === 'sandstone' ? sandstoneEdge(defs, edgeId+'-crumbs') : null;
        for (const [idx, width] of [finish.width, finish.rim].entries()) {
          const edges = rects.map(r =>
            `M${r.x} ${r.y}h${width}v${r.height}h${-width}Z` +
            `M${r.x + r.width - width} ${r.y}h${width}v${r.height}h${-width}Z`).join('');
          group.append(svgNode('path', {
            d: edges, fill: `url(#${gradId})`, opacity: idx ? .8 : mat.texture === 'granite' ? .68 : .42
          }));
          if (crumbs && !idx) group.append(svgNode('path', { d:edges, fill:crumbs }));
        }
      }

      face.append(group);
    }

    return svg;
  }
  renderSVG.token = m => renderSVG(m, 'enamel-token', null, null, true);
  renderSVG.cardMaterials = renderCardMaterials;
  globalThis.ubuRender = renderSVG;
})();
