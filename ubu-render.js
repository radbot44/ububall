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
    const cover = fill => pattern.append(svgNode('rect', { x: -180, y: -180, width: 720, height: 720, fill }));
    function lighting(name, stops, radial = false, attrs = {}) {
      const key = id + '-' + name;
      const gradient = svgNode(radial ? 'radialGradient' : 'linearGradient', {
        id: key, gradientUnits: 'userSpaceOnUse',
        ...(radial ? { cx: 105, cy: 90, r: 265 } : { x1: 0, y1: 0, x2: 360, y2: 0 }), ...attrs
      });
      for (const [offset, color, opacity] of stops) gradient.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
      if (effects) {
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
      cover(`url(#${key})`);
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
      for (let vein = 0; vein < 11; vein++) {
        let x = -230 + vein * 80, d = `M${x} -180`;
        const points = [];
        for (let y = -120; y <= 540; y += 60) {
          const next = x + (roll() - .38) * 95;
          d += `C${x + 28} ${y - 40} ${next - 24} ${y - 20} ${next} ${y}`;
          points.push([next, y]); x = next;
        }
        for (const [width, color, opacity] of [[9, '#fff', .09], [2.3, '#000', .24], [.65, '#fff', .35]]) {
          pattern.append(svgNode('path', { d, fill: 'none', stroke: color, 'stroke-width': width, opacity }));
        }
        for (let i = 1; i < points.length; i += 3) {
          const [px, py] = points[i], direction = roll() < .5 ? -1 : 1;
          pattern.append(svgNode('path', { d: `M${px} ${py}q${direction * 35} -18 ${direction * 52} -52t${direction * 48} -65`,
            fill: 'none', stroke: '#000', 'stroke-width': .7, opacity: .18 }));
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
      // Continuous fine nap: no tiled fiber boundaries, directional bands or specular sheen.
      lighting('velvet-diffuse', [[0, '#000', .08], [.5, '#000', .13], [1, '#000', .22]], true);
      const nap = svgNode('filter', { id: id + '-nap', filterUnits: 'userSpaceOnUse',
        x: -180, y: -180, width: 720, height: 720, 'color-interpolation-filters': 'sRGB' });
      nap.append(svgNode('feTurbulence', { type: 'fractalNoise', baseFrequency: .36, numOctaves: 3, seed: 173 }),
        svgNode('feColorMatrix', { type: 'saturate', values: 0 }));
      const napContrast = svgNode('feComponentTransfer');
      for (const channel of ['R', 'G', 'B']) napContrast.append(svgNode('feFunc' + channel,
        { type: 'linear', slope: 2.4, intercept: -.7 }));
      napContrast.append(svgNode('feFuncA', { type: 'linear', slope: 0, intercept: 1 }));
      nap.append(napContrast);
      defs.append(nap);
      pattern.append(svgNode('rect', { x: -180, y: -180, width: 720, height: 720,
        filter: `url(#${id}-nap)`, opacity: .26 }));
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
    } else if (attribute.texture === 'woodgrain') {
      lighting('wood-depth', [[0, '#fff', .2], [.5, '#fff', .02], [1, '#000', .24]], true);
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
        pattern.append(svgNode('path', { d, fill: 'none', stroke: fiber % 4 ? '#000' : '#fff',
          'stroke-width': .5 + roll() * 1.4, opacity: .1 + roll() * .17 }));
      }
      for (let ring = 1; ring <= 5; ring++) pattern.append(svgNode('ellipse', {
        cx: 140, cy: 180, rx: ring * 3, ry: ring * 9, fill: 'none', stroke: '#000',
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
          const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
          for (let j = 0; j < steps; j++) {
            const x = a[0] + (b[0] - a[0]) * j / steps, y = a[1] + (b[1] - a[1]) * j / steps;
            rough.push([x + 3.5 * Math.sin(y / 7 + x / 19) + .9 * Math.sin(y * 1.7 + x),
              y + 3.5 * Math.sin(x / 8 - y / 23) + .9 * Math.sin(x * 1.5 - y)]);
          }
        }
        const d = 'M' + rough.map(p => p.join(',')).join('L') + 'Z';
        pattern.append(svgNode('path', { d, fill: '#fff', 'fill-opacity': roll() * .07,
          stroke: '#fff', 'stroke-opacity': .2, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
          svgNode('path', { d, fill: 'none', stroke: '#000', 'stroke-opacity': .48,
            'stroke-width': 1.15, 'stroke-linejoin': 'round' }));
        for (let i = 2; i < rough.length; i += 5) {
          const [x, y] = rough[i], r = .5 + roll() * 1.8;
          pattern.append(svgNode('path', { d: `M${x-2} ${y}l${r} ${-r}l${r*.7} ${r*1.4}Z`,
            fill: i % 3 ? '#000' : '#fff', opacity: .15 + roll() * .2 }));
        }
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
      lighting('diffuse', [[0, '#fff', .19], [.5, '#fff', .03], [1, '#000', .2]], true);
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
    }
    defs.append(pattern);
    return `url(#${id})`;
  }
  function materialEdge(defs, face, shapes, attribute, id, effects) {
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
      crystalline: { width: 2, rim: .45, stops: [[0, '#fff', .9], [.24, '#fff', .55], [.25, '#000', .32], [.49, '#000', .12], [.5, '#fff', .8], [.74, '#fff', .2], [.75, '#000', .42], [1, '#000', .55]] }
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
    for (const [index, width] of [finish.width, finish.rim].entries()) {
      const key = id + '-' + index;
      const filter = svgNode('filter', { id: key + '-cut', filterUnits: 'userSpaceOnUse',
        x: 0, y: 0, width: 360, height: 360, 'color-interpolation-filters': 'sRGB' });
      filter.append(svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: width, result: 'inset' }),
        svgNode('feComposite', { in: 'SourceGraphic', in2: 'inset', operator: 'out' }));
      const mask = svgNode('mask', { id: key + '-mask', maskUnits: 'userSpaceOnUse',
        maskContentUnits: 'userSpaceOnUse', x: 0, y: 0, width: 360, height: 360 });
      const silhouette = svgNode('g', { fill: '#fff', filter: `url(#${key}-cut)` });
      for (const shape of shapes) silhouette.append(shape.cloneNode(true));
      mask.append(silhouette); defs.append(filter, mask);
      face.append(svgNode('rect', { width: 360, height: 360, fill: `url(#${id}-light)`,
        mask: `url(#${key}-mask)`, opacity: index ? .8 : .38 }));
    }
  }
  function renderSVG(m, className = 'oomark', surface = null, extraEffects = null) {
    const effects = className === 'oomark' ? (extraEffects || []) : null;
    const prefix = 'ubu-' + (++serial);
    const svg = svgNode('svg', { class: className, viewBox: '0 0 360 360', role: 'img', 'aria-label': `${m.parts.fullName}, Ubuquity ${m.grade}` });
    const title = svgNode('title'); title.textContent = `${m.parts.fullName} · ${m.grade}`;
    const defs = svgNode('defs');
    const bounds = svgNode('clipPath', { id: prefix + '-bounds', clipPathUnits: 'userSpaceOnUse' });
    bounds.append(svgNode('circle', { cx: 180, cy: 180, r: 176 })); defs.append(bounds);
    const face = svgNode('g', { 'clip-path': `url(#${prefix}-bounds)` });
    svg.append(title, defs, face);
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
        'velvet', 'frosted', 'woodgrain', 'holographic', 'terrazzo', 'crackle', 'plush', 'opalescent'].includes(attribute.texture);
      const fill = designed
        ? material(defs, attribute, prefix + '-' + role + '-texture', effects)
        : (matteFill ||= material(defs, { texture: 'matte', angle: 0 }, prefix + '-matte', effects));
      face.append(svgNode('rect', { x: 0, y: 0, width: 360, height: 360, fill, 'clip-path': `url(#${clipId})` }));
      if (designed) materialEdge(defs, face, shapes[role], attribute, prefix + '-' + role + '-edge', effects);
    }
    const domeId = prefix + '-dome';
    const dome = svgNode('radialGradient', { id: domeId, gradientUnits: 'userSpaceOnUse', cx: 180, cy: 175, r: 176 });
    dome.append(
      svgNode('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': .10 }),
      svgNode('stop', { offset: '38%', 'stop-color': '#fff', 'stop-opacity': .02 }),
      svgNode('stop', { offset: '70%', 'stop-color': '#000', 'stop-opacity': .01 }),
      svgNode('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': .09 })
    );
    defs.append(dome);
    face.append(svgNode('circle', { cx: 180, cy: 180, r: 176, fill: `url(#${domeId})`, 'pointer-events': 'none' }));
    if (effects) {
      effects.push((x, y) => {
        dome.setAttribute('cx', String(180 + x * 20));
        dome.setAttribute('cy', String(175 + y * 20));
      });
    }
    if (effects) attachLighting(svg, effects, surface || svg);
    return svg;
  }
  let stopLighting = () => {};
  function attachLighting(svg, effects, surface) {
    stopLighting();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, x = 0, y = 0, targetX = 0, targetY = 0, rect;
    svg.style.filter = 'drop-shadow(0px 8px 9px #0005)';
    function paint() {
      frame = 0;
      x += (targetX - x) * .18; y += (targetY - y) * .18;
      const settled = Math.abs(targetX - x) + Math.abs(targetY - y) < .001;
      if (settled) { x = targetX; y = targetY; }
      surface.style.transform = `perspective(700px) rotateX(${-y * 12}deg) rotateY(${x * 12}deg)`;
      if (surface !== svg) {
        surface.style.setProperty('--light-x', `${50 + x * 45}%`);
        surface.style.setProperty('--light-y', `${50 + y * 45}%`);
      }
      svg.style.filter = `drop-shadow(${-x * 9}px ${8 - y * 6}px 9px #0005)`;
      for (const effect of effects) effect(x, y);
      if (!settled) frame = requestAnimationFrame(paint);
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
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
      if (reduced.matches) { targetX = targetY = x = y = 0; schedule(); }
    }
    reduced.addEventListener('change', preferenceChanged);
    window.addEventListener('blur', reset);
    stopLighting = () => {
      cancelAnimationFrame(frame);
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
          angle: attr.angle ?? 45
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
      viewBox: '0 0 320 480',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true'
    });
    const defs = svgNode('defs');
    svg.append(defs);

    const boundsId = `${prefix}-bounds`;
    const bounds = svgNode('clipPath', { id: boundsId, clipPathUnits: 'userSpaceOnUse' });
    bounds.append(svgNode('rect', { x: 0, y: 0, width: 320, height: 480, rx: 16, ry: 16 }));
    defs.append(bounds);

    const face = svgNode('g', { 'clip-path': `url(#${boundsId})` });
    svg.append(face);

    const S = 44;
    const span = 420;
    // Keep the original generous mask bounds: some browsers clip transformed
    // masks differently when their region is tightened to the card's outline.
    const region = { x: -span, y: -span, width: span * 2 + 320, height: span * 2 + 480 };

    function getLayerRects(layer) {
      const { angleIndex, angleTotal } = layer;
      const cycle = S * 2 * angleTotal;
      const offset = angleIndex * S * 2;
      const start = -Math.ceil((span + cycle) / cycle) * cycle;
      const rects = [];
      for (let base = start; base <= span + 320; base += cycle) {
        rects.push({ x: base + offset, y: -span, width: S, height: span * 2 + 480 });
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
      damascus: { width: 2, rim: .5, stops: [[0, '#fff', .6], [.4, '#fff', .15], [1, '#000', .3]] },
      velvet: { width: 1.5, rim: .4, stops: [[0, '#fff', .25], [.5, '#fff', .05], [1, '#000', .2]] },
      plush: { width: 1.5, rim: .4, stops: [[0, '#fff', .25], [.5, '#fff', .05], [1, '#000', .2]] }
    };

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const { mat, angle, rects } = layer;
      const patId = `${prefix}-pat-${i}`;
      const fill = material(defs, { ...mat, angle: 0 }, patId, effects, 160, 240);

      const group = svgNode('g', {
        transform: `rotate(${angle} 160 240)`
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
            transform: `rotate(${upper.angle - angle} 160 240)`
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

      for (const r of rects) {
        group.append(
          svgNode('rect', {
            x: r.x, y: r.y, width: r.width, height: r.height,
            fill: mat.hex, opacity: .65
          }),
          svgNode('rect', {
            x: r.x, y: r.y, width: r.width, height: r.height,
            fill
          })
        );
      }

      const finish = finishes[mat.texture];
      if (finish) {
        const edgeId = `${prefix}-edge-${i}`;
        const gradId = `${edgeId}-light`;
        const grad = svgNode('linearGradient', {
          id: gradId, gradientUnits: 'userSpaceOnUse',
          x1: 0, y1: 0, x2: 320, y2: 0
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
        for (const [idx, width] of [finish.width, finish.rim].entries()) {
          for (const r of rects) {
            for (const x of [r.x, r.x + r.width - width]) {
              group.append(svgNode('rect', {
                x, y: r.y, width, height: r.height,
                fill: `url(#${gradId})`,
                opacity: idx ? .8 : .42
              }));
            }
          }
        }
      }

      face.append(group);
    }

    return svg;
  }
  renderSVG.cardMaterials = renderCardMaterials;
  globalThis.ubuRender = renderSVG;
})();
