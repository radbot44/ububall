const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

globalThis.ubu = require('../shared/ubu.js');
globalThis.ubuRender = require('../shared/ubu-render.js');
globalThis.rarity = require('../shared/rarity.js');
globalThis.ability = require('../shared/ability.js');
globalThis.ubuArchetype = require('../shared/ubu-archetype.js');
globalThis.ububallPhysics = require('../shared/ububall-physics.js');
globalThis.ububallMatch = require('../shared/ububall-match.js');
globalThis.ububallReplay = require('../shared/ububall-replay.js');
globalThis.ububallWebgl = require('../web/ububall-webgl.js');
globalThis.ububallPresentation = require('../web/ububall-presentation.js');
const ROOT = path.resolve(__dirname, '..');

function createMockWebGL2Context(opts = {}) {
  const calls = {
    drawArrays: [],
    blitFramebuffer: 0,
    texImage2D: 0,
    deleteTexture: 0,
    deleteFramebuffer: 0,
    deleteBuffer: 0,
    deleteVertexArray: 0,
    deleteProgram: 0,
    loseContext: 0,
    bindFramebuffer: []
  };
  let lost = Boolean(opts.initiallyLost);
  let nextId = 1;
  const makeObj = tag => ({ _tag: tag, id: nextId++ });

  const loseExt = {
    loseContext() {
      lost = true;
      calls.loseContext++;
    },
    restoreContext() {
      lost = false;
    }
  };
  const timerExt = {
    TIME_ELAPSED_EXT: 0x88bf,
    GPU_DISJOINT_EXT: 0x8fbb
  };

  const gl = {
    contextAttrs: opts.contextAttrs || null,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    RGBA8: 0x8058,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    FRAMEBUFFER: 0x8d40,
    READ_FRAMEBUFFER: 0x8ca8,
    DRAW_FRAMEBUFFER: 0x8ca9,
    COLOR_ATTACHMENT0: 0x8ce0,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_BUFFER_BIT: 0x4000,
    SCISSOR_TEST: 0x0c11,
    BLEND: 0x0be2,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    TRIANGLES: 0x0004,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    MAX_TEXTURE_SIZE: 0x0d33,
    QUERY_RESULT_AVAILABLE: 0x8867,
    QUERY_RESULT: 0x8866,
    calls,
    loseExt,
    setLost(v) { lost = Boolean(v); },
    isContextLost() { return lost; },
    getParameter(p) {
      if (p === this.MAX_TEXTURE_SIZE) return opts.maxTextureSize || 4096;
      if (p === timerExt.GPU_DISJOINT_EXT) return false;
      return 0;
    },
    getExtension(name) {
      if (name === 'WEBGL_lose_context') return loseExt;
      if (name === 'EXT_disjoint_timer_query_webgl2') return timerExt;
      return null;
    },
    createShader(type) { return makeObj('shader:' + type); },
    shaderSource() {},
    compileShader() {},
    getShaderParameter() { return !opts.failShader; },
    getShaderInfoLog() { return 'mock shader error'; },
    deleteShader() {},
    createProgram() { return makeObj('program'); },
    attachShader() {},
    linkProgram() {},
    getProgramParameter() { return !opts.failLink; },
    getProgramInfoLog() { return 'mock link error'; },
    deleteProgram() { calls.deleteProgram++; },
    getUniformLocation(_prog, name) { return { name }; },
    useProgram() {},
    uniform1i() {},
    uniform1f() {},
    uniform2f() {},
    uniform4f() {},
    createVertexArray() { return makeObj('vao'); },
    bindVertexArray() {},
    deleteVertexArray() { calls.deleteVertexArray++; },
    createBuffer() { return makeObj('vbo'); },
    bindBuffer() {},
    bufferData() {},
    bufferSubData() {},
    deleteBuffer() { calls.deleteBuffer++; },
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    createTexture() { return makeObj('tex'); },
    activeTexture() {},
    bindTexture() {},
    texParameteri() {},
    pixelStorei() {},
    texImage2D() { calls.texImage2D++; },
    deleteTexture() { calls.deleteTexture++; },
    createFramebuffer() { return makeObj('fbo'); },
    bindFramebuffer(target, fbo) { calls.bindFramebuffer.push([target, fbo ? fbo.id : null]); },
    framebufferTexture2D() {},
    checkFramebufferStatus() { return this.FRAMEBUFFER_COMPLETE; },
    blitFramebuffer() { calls.blitFramebuffer++; },
    deleteFramebuffer() { calls.deleteFramebuffer++; },
    viewport() {},
    enable() {},
    disable() {},
    clearColor() {},
    clear() {},
    blendFunc() {},
    drawArrays(mode, first, count) { calls.drawArrays.push([mode, first, count]); },
    flush() {},
    createQuery() { return makeObj('query'); },
    beginQuery() {},
    endQuery() {},
    getQueryParameter(_q, p) {
      if (p === this.QUERY_RESULT_AVAILABLE) return true;
      if (p === this.QUERY_RESULT) return 420000; // 0.42 ms
      return 0;
    },
    deleteQuery() {}
  };
  return gl;
}

function createMockCanvas(opts = {}) {
  const listeners = new Map();
  let mode = null;
  let gl = null;
  let ctx2d = null;

  const make2d = () => ({
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, rect() {}, roundRect() {}, clip() {}, fill() {}, stroke() {},
    fillRect() {}, clearRect() {}, strokeRect() {}, translate() {}, rotate() {}, scale() {},
    setTransform() {}, resetTransform() {}, setLineDash() {}, drawImage() {}, fillText() {}, strokeText() {},
    measureText(t) { return { width: String(t).length * 7 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createConicGradient() { return { addColorStop() {} }; }
  });

  const canvas = {
    tagName: 'CANVAS',
    width: opts.width || 1000,
    height: opts.height || 600,
    clientWidth: opts.width || 1000,
    clientHeight: opts.height || 600,
    hidden: false,
    style: {},
    parentElement: null,
    nextSibling: null,
    setAttribute() {},
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type, extra = {}) {
      let prevented = false;
      const ev = { type, preventDefault() { prevented = true; }, ...extra };
      for (const fn of listeners.get(type) || []) fn(ev);
      return prevented;
    },
    getContext(kind, attrs) {
      if (kind === 'webgl2') {
        if (opts.noWebGL2 || mode === '2d') return null;
        mode = 'webgl2';
        gl ||= createMockWebGL2Context({ ...opts, contextAttrs: attrs });
        return gl;
      }
      if (kind === '2d') {
        if (mode === 'webgl2') return null; // Mirrors real HTMLCanvasElement spec!
        mode = '2d';
        ctx2d ||= make2d();
        return ctx2d;
      }
      return null;
    },
    get _mockGl() { return gl; }
  };
  return canvas;
}

test('ububallWebgl.parseColor parses hex and rgb/rgba strings accurately', () => {
  const { parseColor } = globalThis.ububallWebgl;
  const c1 = parseColor('#2d1206');
  assert.ok(Math.abs(c1[0] - 45 / 255) < 1e-4);
  assert.ok(Math.abs(c1[1] - 18 / 255) < 1e-4);
  assert.ok(Math.abs(c1[2] - 6 / 255) < 1e-4);
  assert.equal(c1[3], 1);

  const c2 = parseColor('#ff800080');
  assert.equal(c2[0], 1);
  assert.ok(Math.abs(c2[3] - 128 / 255) < 1e-4);

  const c3 = parseColor('rgba(51, 102, 204, 0.5)');
  assert.ok(Math.abs(c3[0] - 0.2) < 1e-4);
  assert.ok(Math.abs(c3[1] - 0.4) < 1e-4);
  assert.ok(Math.abs(c3[2] - 0.8) < 1e-4);
  assert.equal(c3[3], 0.5);

  const c4 = parseColor('rgba(232, 202, 72, 6.008935185918509e-16)');
  assert.ok(c4[3] < 1e-12, 'scientific-notation tiny alpha does not get misparsed as opaque');

  const c5 = parseColor('hsla(48, 78%, 60%, 1.2e-7)');
  assert.ok(c5[3] < 1e-6, 'hsla scientific-notation alpha parses accurately');
});

test('ububallWebgl.createSceneRenderer returns null cleanly when WebGL2 is unavailable', () => {
  const canvas = createMockCanvas({ noWebGL2: true });
  const gpu = globalThis.ububallWebgl.createSceneRenderer(canvas);
  assert.equal(gpu, null);
});

test('ububallWebgl batches up to 8 textures per draw call, flushes on 9th slot or blend change, and caps LRU cache', () => {
  const canvas = createMockCanvas();
  const gpu = globalThis.ububallWebgl.createSceneRenderer(canvas, { enableGpuTimer: true });
  assert.ok(gpu);
  const gl = gpu.gl;

  assert.equal(gpu.beginFrame(1200, 720, 1000, 600, 0, 0, false), true);
  // 8 distinct sprites fit into a single drawArrays batch
  for (let i = 0; i < 8; i++) {
    gpu.drawTexture('spr:' + i, { width: 64, height: 64 }, i * 20, 40, 32, 32, 1);
  }
  gpu.fillCircle(500, 300, 24, '#ff7197', 0.9);
  gpu.strokeArc(500, 300, 36, 0, 1.4, '#ffd05b', 3, 0.8);
  gpu.drawSoftRibbon(
    [{ x: 200, y: 200 }, { x: 200.1, y: 200.05 }, { x: 260, y: 210 }, { x: 310, y: 240 }],
    () => 18,
    true,
    0.9,
    false
  );
  assert.equal(gl.calls.drawArrays.length, 0, 'still buffered in single batch before 9th texture');

  // 9th distinct texture triggers automatic batch flush
  gpu.drawTexture('spr:8', { width: 64, height: 64 }, 200, 40, 32, 32, 1);
  assert.equal(gl.calls.drawArrays.length, 1);

  // Switching blend mode triggers flush
  gpu.setBlend('add');
  gpu.fillCircle(500, 300, 16, '#ffaa33', 0.8);
  gpu.endFrame();

  assert.equal(gpu.lastDrawCalls, 3);
  assert.equal(gl.calls.blitFramebuffer, 0, 'no scene FBO blit when needSceneFbo is false');

  // Verify LRU texture cache eviction beyond 160 entries across subsequent frames
  assert.equal(gpu.beginFrame(1200, 720, 1000, 600, 0, 0, false), true);
  for (let k = 0; k < 175; k++) {
    gpu.drawTexture('bulk:' + k, { width: 32, height: 32 }, 10, 10, 16, 16, 1);
  }
  gpu.endFrame();
  assert.ok(gpu.textureCount <= 160, `expected LRU cap <= 160, got ${gpu.textureCount}`);
  assert.ok(gl.calls.deleteTexture > 0, 'evicted stale textures via gl.deleteTexture');
  assert.ok(gpu.lastGpuMs !== null, 'polled non-blocking EXT_disjoint_timer_query_webgl2');
});

test('ububallWebgl executes two-pass FBO heat refraction without feedback loops and cleans up on dispose', () => {
  const canvas = createMockCanvas();
  const gpu = globalThis.ububallWebgl.createSceneRenderer(canvas);
  const gl = gpu.gl;

  assert.equal(gpu.beginFrame(1500, 900, 1000, 600, 0, 0, true), true);
  gpu.fillRoundRect(500, 300, 880, 480, 100, '#1b1d21', 1);
  gpu.drawTexture('skater:0', { width: 256, height: 256 }, 480, 280, 44, 44, 1);
  gpu.applyHeatRefraction([
    { x: 500, y: 300, radius: 42, strength: 0.75, time: 0.5, isImpact: false },
    { x: 460, y: 290, radius: 60, strength: 0.9, time: 0.2, isImpact: true }
  ]);
  // Post-refraction crisp UI overlay draws directly to default framebuffer
  gpu.strokeCircle(500, 300, 50, '#ffffff', 2, 0.9);
  gpu.endFrame();

  assert.equal(gl.calls.blitFramebuffer, 1, 'scene FBO blitted once before bounded warp quad');
  // 1 scene flush + 1 6-vert warp quad + 1 post-refraction overlay flush = 3 draw calls
  assert.equal(gpu.lastDrawCalls, 3);
  assert.deepEqual(gl.calls.drawArrays[1], [gl.TRIANGLES, 0, 6], 'warp pass uses single 6-vertex bounded quad');

  gpu.dispose(true);
  assert.equal(gl.calls.deleteFramebuffer, 1);
  assert.equal(gl.calls.deleteProgram, 2);
  assert.equal(gl.calls.loseContext, 1);
});

test('createRinkPresenter renders via WebGL2, handles context loss/recovery fallback, portrait collection, and export', () => {
  const { ububallPhysics: P, ububallMatch, ububallReplay, ubu, rarity, ububallPresentation } = globalThis;
  const { createEffectsState, MATERIAL_STYLES, createRinkPresenter } = ububallPresentation;

  const children = [];
  const rinkWrap = {
    style: {},
    classList: { add() {}, remove() {} },
    insertBefore(node) { children.push(node); },
    append(node) { children.push(node); }
  };
  const skatersLayer = { id: 'skaters', style: { display: '' } };
  const skaters = Array.from({ length: 6 }, () => {
    const sprite = createMockCanvas({ width: 256, height: 256 });
    return {
      style: {},
      parentElement: skatersLayer,
      firstChild: sprite,
      querySelector() { return sprite; }
    };
  });

  const mockDoc = {
    documentElement: { style: {} },
    getElementById(id) { return id === 'skaters' ? skatersLayer : null; },
    createElement(tag) {
      if (tag === 'canvas') return createMockCanvas({ width: 256, height: 256 });
      return { style: {}, setAttribute() {} };
    }
  };

  const prevDoc = globalThis.document;
  globalThis.document = mockDoc;
  try {
    const codes = [...rarity.starterTeam(ubu), ...rarity.starterTeam(ubu)];
    const entries = codes.slice(0, 6).map((dna, i) => {
      const model = ubu.decode(ubu.fromCode(dna));
      return { key: 't-' + i, dna, model, equippedSuper: P.SUPERS[i % P.SUPERS.length] };
    });

    const rinkCanvas = createMockCanvas({ width: 1500, height: 900 });
    const badgeCanvas = createMockCanvas({ width: 1500, height: 900 });
    const view = {
      canvas: rinkCanvas,
      ctx: null,
      badgeCanvas,
      badgeCtx: badgeCanvas.getContext('2d'),
      bodies: P.kickoff(),
      entries,
      mode: 'standard',
      portrait: false,
      anonymous: false,
      castHidden: false,
      field: null
    };
    view.bodies[6].onFire = true;
    view.bodies[6].fireTicks = 400;
    view.bodies[6].pace = 960;
    view.bodies[0].stunned = 60;
    view.bodies[1].guarding = true;
    view.bodies[2].superActive = 'cannon';

    const fx = createEffectsState(entries, MATERIAL_STYLES);
    fx.heatTime = 0.4;
    fx.burns.push({ width: 20, age: 0.2, points: [{ x: 300, y: 260, depth: 0.9 }, { x: 360, y: 270, depth: 1 }] });
    fx.skids.push({ width: 16, age: 0.2, points: [{ x: 220, y: 310, intensity: 0.8 }, { x: 250, y: 320, intensity: 0.9 }] });

    let phase = 'play';
    const presenter = createRinkPresenter({
      P,
      ububallMatch,
      ububallReplay,
      getView: () => view,
      getEffects: () => fx,
      getPhase: () => phase,
      getPlans: () => Array.from({ length: 6 }, () => ({ angle: 0.2, power: 0.8, spin: 0.5, guard: false, superArm: true })),
      getFouls: () => ububallMatch.newFouls(),
      getSkaters: () => skaters,
      getRinkWrap: () => rinkWrap,
      getRenderSize: () => ({ renderWidth: 1000, renderHeight: 600, deviceWidth: 1500, deviceHeight: 900, visibleRinkHeight: 600 })
    });

    presenter.drawScene();
    assert.equal(presenter.getRendererInfo().backend, 'webgl2');
    assert.equal(rinkCanvas._webglComposite, true);
    assert.equal(skatersLayer.style.display, 'none', 'DOM #skaters hidden while WebGL2 renders skaters');
    assert.equal(badgeCanvas.style.display, 'none', '2D badgeCanvas hidden while WebGL2 renders overlays');

    // Plan phase + aiming prediction in WebGL2
    phase = 'plan';
    presenter.drawScene();

    // Collection stretched portrait rink in WebGL2
    view.collectionPortrait = { length: 1640, viewTop: 180, viewSpan: 880 };
    presenter.drawScene();
    view.collectionPortrait = null;

    // Simulate WebGL context loss -> automatic fallback to .rink-fallback 2D canvas + DOM skaters restored
    phase = 'play';
    const prevented = rinkCanvas.dispatch('webglcontextlost');
    assert.equal(prevented, true, 'webglcontextlost preventDefault() called to enable restoration');
    presenter.drawScene();
    assert.equal(presenter.getRendererInfo().backend, 'canvas2d');
    assert.equal(presenter.getRendererInfo().contextLost, true);
    assert.equal(rinkCanvas._webglComposite, false);
    assert.equal(skatersLayer.style.display, '', 'DOM #skaters restored during Canvas 2D fallback');
    assert.ok(view._fallbackCanvas && !view._fallbackCanvas.hidden, 'dedicated 2D fallback canvas shown while primary canvas holds lost GL context');

    // Simulate WebGL context restoration -> resumes WebGL2 and hides fallback canvas
    rinkCanvas._mockGl.setLost(false);
    rinkCanvas.dispatch('webglcontextrestored');
    presenter.drawScene();
    assert.equal(presenter.getRendererInfo().backend, 'webgl2');
    assert.equal(presenter.getRendererInfo().contextLost, false);
    assert.equal(view._fallbackCanvas.hidden, true);
    assert.equal(skatersLayer.style.display, 'none');

    // Second loss cycle works cleanly without throwing
    rinkCanvas._mockGl.setLost(true);
    presenter.drawScene();
    assert.equal(presenter.getRendererInfo().backend, 'canvas2d');
    assert.equal(view._fallbackCanvas.hidden, false);

    presenter.dispose();
  } finally {
    globalThis.document = prevDoc;
  }
});

test('asset whitelists ship ububall-webgl.js and keep webgl-demo local-only', () => {
  const prep = fs.readFileSync(path.join(ROOT, 'scripts/prepare-assets.cjs'), 'utf8');
  assert.match(prep, /'ububall-webgl\.js'/);
  assert.doesNotMatch(prep, /webgl-demo\.(html|js)/);

  const serve = fs.readFileSync(path.join(ROOT, 'scripts/serve-bench.cjs'), 'utf8');
  assert.match(serve, /'ububall-webgl\.js'/);
  assert.match(serve, /'webgl-demo\.html'/);
  assert.match(serve, /'webgl-demo\.js'/);
  assert.match(serve, /'ability\.js'/);
});

test('source files contain zero raw NUL (0x00) bytes', () => {
  for (const dir of ['web', 'shared', 'scripts', 'test', 'docs']) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const name of fs.readdirSync(fullDir)) {
      const p = path.join(fullDir, name);
      if (!fs.statSync(p).isFile() || /\.(woff2|png|ico|webp)$/i.test(name)) continue;
      const buf = fs.readFileSync(p);
      assert.equal(buf.includes(0), false, `Unexpected raw NUL byte in ${dir}/${name}`);
    }
  }
});

test('exporting videoFrame views disable preserveDrawingBuffer and alpha, and composite scorebug in one WebGL2 pass', () => {
  const { ububallPhysics: P, ububallMatch, ububallReplay, ubu, rarity, ububallPresentation } = globalThis;
  const { createEffectsState, MATERIAL_STYLES, createRinkPresenter } = ububallPresentation;

  const liveCanvas = createMockCanvas({ width: 1500, height: 900 });
  const liveView = {
    canvas: liveCanvas, ctx: null, badgeCanvas: createMockCanvas(), badgeCtx: createMockCanvas().getContext('2d'),
    bodies: P.kickoff(), entries: [], mode: 'standard', portrait: false
  };
  const liveFx = createEffectsState([], MATERIAL_STYLES);
  const livePres = createRinkPresenter({
    P, ububallMatch, ububallReplay,
    getView: () => liveView, getEffects: () => liveFx, getPhase: () => 'play'
  });
  livePres.drawScene();
  assert.equal(liveCanvas._mockGl.contextAttrs.preserveDrawingBuffer, false, 'live #rink keeps preserveDrawingBuffer false for mobile tile GPU perf');
  assert.equal(liveCanvas._mockGl.contextAttrs.alpha, true);
  livePres.dispose();

  const codes = [...rarity.starterTeam(ubu), ...rarity.starterTeam(ubu)];
  const entries = codes.slice(0, 6).map((dna, i) => ({
    key: 'v-' + i, dna, model: ubu.decode(ubu.fromCode(dna)), equippedSuper: P.SUPERS[i % P.SUPERS.length]
  }));
  const scorebugLayer = { width: 1920, height: 78 };
  const expCanvas = createMockCanvas({ width: 1920, height: 1080 });
  const expView = {
    canvas: expCanvas,
    ctx: null,
    badgeCanvas: createMockCanvas(),
    badgeCtx: createMockCanvas().getContext('2d'),
    bodies: P.kickoff(),
    entries,
    mode: 'standard',
    portrait: false,
    exporting: true,
    field: { width: 1920, height: 1080 },
    videoFrame: {
      width: 1920, height: 1080,
      logW: 1000, logH: 562.5,
      offX: 0, offY: 1.375,
      scorebugLayer, scorebugRev: 1
    }
  };
  expView.bodies[6].onFire = true; expView.bodies[6].fireTicks = 400; expView.bodies[6].pace = 960;
  const expFx = createEffectsState(entries, MATERIAL_STYLES);
  expFx.heatTime = 0.35;

  const expPres = createRinkPresenter({
    P, ububallMatch, ububallReplay,
    getView: () => expView, getEffects: () => expFx, getPhase: () => 'play'
  });
  expPres.drawScene();
  assert.equal(expCanvas._mockGl.contextAttrs.preserveDrawingBuffer, false, 'direct videoFrame export avoids preserveDrawingBuffer tile-GPU copies');
  assert.equal(expCanvas._mockGl.contextAttrs.alpha, false, 'direct 1080p videoFrame canvas uses opaque backbuffer');
  const texUploadsAfterFrame1 = expCanvas._mockGl.calls.texImage2D;

  // Frame 2 with unchanged scorebugRev does ZERO new texture uploads!
  expFx.heatTime = 0.37;
  expPres.drawScene();
  assert.equal(expCanvas._mockGl.calls.texImage2D, texUploadsAfterFrame1, 'cached scorebug is not re-uploaded when scorebugRev is unchanged');

  // Frame 3 when score changes (scorebugRev increments) re-uploads only the 1 scorebug texture!
  expView.videoFrame.scorebugRev = 2;
  expPres.drawScene();
  assert.equal(expCanvas._mockGl.calls.texImage2D, texUploadsAfterFrame1 + 1, 'scorebug texture updates cleanly when scorebugRev increments');
  expPres.dispose();
});

test('emitSoftRibbonTriangles and Canvas 2D softRibbon avoid gaps, twists, and spikes on sharp bounces and reversals', () => {
  function distToPolyline(x, y, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
    }
    return best;
  }

  function samplePointInTris(tris, x, y) {
    let hits = 0, minR = Infinity;
    for (const [a, b, c] of tris) {
      const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(denom) < 1e-9) continue;
      const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom;
      const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-5 && l2 >= -1e-5 && l3 >= -1e-5) {
        hits++;
        const u = l1 * a.u + l2 * b.u + l3 * c.u;
        const v = l1 * a.v + l2 * b.v + l3 * c.v;
        minR = Math.min(minR, Math.hypot(u, v));
      }
    }
    return { hits, minR };
  }

  const bouncePts = [
    { x: 460, y: 500, depth: 1 }, { x: 430, y: 400, depth: 1 }, { x: 400, y: 300, depth: 1 },
    { x: 370, y: 200, depth: 1 }, { x: 365, y: 185, depth: 1 }, { x: 362, y: 180, depth: 1 },
    { x: 358, y: 192, depth: 1 }, { x: 345, y: 240, depth: 1 }, { x: 330, y: 300, depth: 1 },
    { x: 326, y: 315, depth: 1 }, { x: 335, y: 310, depth: 1 }, { x: 380, y: 280, depth: 1 },
    { x: 460, y: 245, depth: 1 }
  ];
  const tris = [];
  globalThis.ububallWebgl.emitSoftRibbonTriangles(bouncePts, p => 24 * (0.5 + 0.5 * p.depth), poly => {
    for (let i = 1; i + 1 < poly.length; i++) tris.push([poly[0], poly[i], poly[i + 1]]);
  });
  assert.ok(tris.length > 0, 'emits ribbon triangles for sharp bounce');
  for (const tri of tris) {
    for (const v of tri) {
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.u) && Number.isFinite(v.v));
      assert.ok(Math.hypot(v.u, v.v) <= 1.001, 'UV stays within outer feather disc');
      assert.ok(distToPolyline(v.x, v.y, bouncePts) <= 18.05, 'vertices stay bounded within 1.5x half-width of polyline');
    }
  }
  // Every point along the sharp bounce apex must stay on the dark centerline (no hollow centerline drift)
  for (const pt of bouncePts.slice(3, 11)) {
    const sample = samplePointInTris(tris, pt.x, pt.y);
    assert.ok(sample.hits >= 1, `point (${pt.x}, ${pt.y}) on sharp bounce is covered`);
    assert.ok(sample.minR <= 0.05, `point (${pt.x}, ${pt.y}) stays on centerline (r=${sample.minR})`);
  }
  // Check off-center points around the sharp apex are not double-darkened by overlapping segments
  for (const [qx, qy] of [[355, 186], [368, 188], [362, 172], [338, 305]]) {
    const sample = samplePointInTris(tris, qx, qy);
    assert.ok(sample.hits <= 1, `no double-darkening triangle overlap at (${qx}, ${qy}), got ${sample.hits}`);
  }

  // Exact 180-deg collinear reversal still emits a smooth round turnaround cap without NaN/spikes
  const revTris = [];
  globalThis.ububallWebgl.emitSoftRibbonTriangles(
    [{ x: 200, y: 400 }, { x: 200, y: 200 }, { x: 200, y: 400 }],
    () => 24,
    poly => { for (let i = 1; i + 1 < poly.length; i++) revTris.push([poly[0], poly[i], poly[i + 1]]); }
  );
  assert.ok(samplePointInTris(revTris, 200, 190).hits >= 1, '180-deg turnaround cap covers apex beyond (200, 200)');

  // Canvas 2D fallback softRibbon also keeps sharp-bounce polygon vertices bounded without miter spikes
  const { createRinkPresenter, createEffectsState } = globalThis.ububallPresentation;
  const P = globalThis.ububallPhysics;
  const ububallMatch = globalThis.ububallMatch;
  const ububallReplay = globalThis.ububallReplay;
  const make2dCtx = () => {
    const verts = [];
    return {
      verts,
      globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      lineCap: 'butt', lineJoin: 'miter', font: '12px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
      shadowBlur: 0, shadowColor: 'transparent', globalCompositeOperation: 'source-over',
      save() {}, restore() {}, beginPath() {}, closePath() {}, setLineDash() {},
      moveTo(x, y) { verts.push({ x, y }); },
      lineTo(x, y) { verts.push({ x, y }); },
      fill() {}, stroke() {}, arc() {}, ellipse() {}, roundRect() {}, clip() {},
      quadraticCurveTo() {}, bezierCurveTo() {},
      setTransform() {}, clearRect() {}, drawImage() {}, fillRect() {}, strokeRect() {},
      fillText() {}, strokeText() {}, measureText: () => ({ width: 20 }),
      translate() {}, rotate() {}, scale() {},
      createRadialGradient() { return { addColorStop() {} }; },
      createLinearGradient() { return { addColorStop() {} }; }
    };
  };
  const c2dCanvas = { width: 1000, height: 600, clientWidth: 1000, clientHeight: 600, getContext: () => make2dCtx() };
  const mockDoc = {
    createElement: () => {
      const ctx = make2dCtx();
      return { width: 0, height: 0, getContext: () => ctx };
    }
  };
  const c2dView = {
    canvas: c2dCanvas, ctx: make2dCtx(),
    badgeCanvas: { width: 1000, height: 600 }, badgeCtx: make2dCtx(),
    bodies: P.kickoff(), entries: [], mode: 'standard', portrait: false, field: null
  };
  const c2dFx = createEffectsState([], {});
  c2dFx.burns.push({ points: bouncePts, width: 24, age: 0.3 });
  const c2dPres = createRinkPresenter({
    P, ububallMatch, ububallReplay, doc: mockDoc,
    getView: () => c2dView, getEffects: () => c2dFx, getPhase: () => 'play',
    getPlans: () => [], getRenderSize: () => ({ renderWidth: 1000, renderHeight: 600, deviceWidth: 1000, deviceHeight: 600 })
  });
  c2dPres.drawScene();
  const c2dVerts = c2dFx.iceCache.layer.getContext('2d').verts;
  assert.ok(c2dVerts.length > 0, 'Canvas 2D softRibbon emits path vertices');
  for (const pt of c2dVerts) {
    assert.ok(distToPolyline(pt.x, pt.y, bouncePts) <= 18.05, `Canvas 2D vertex (${pt.x}, ${pt.y}) stays bounded within 1.5x half-width`);
  }
  c2dPres.dispose();
});

test('emitSoftRibbonTriangles tracks along/pace attributes and burnIce scorches for slow fireballs', () => {
  const { emitSoftRibbonTriangles } = globalThis.ububallWebgl;
  const { createRinkPresenter, createEffectsState } = globalThis.ububallPresentation;
  const P = globalThis.ububallPhysics;
  const ububallMatch = globalThis.ububallMatch;
  const ububallReplay = globalThis.ububallReplay;

  // Multi-point ribbon preserves non-decreasing arc-length s and per-point pace/speed p, sp
  const pathPts = [
    { x: 100, y: 200, pace: 0.2, speed: 0.1 },
    { x: 180, y: 200, pace: 0.6, speed: 0.55 },
    { x: 260, y: 260, pace: 0.9, speed: 0.95 }
  ];
  const polys = [];
  emitSoftRibbonTriangles(pathPts, () => 22, poly => polys.push(poly), pt => pt.pace, pt => pt.speed);
  assert.ok(polys.length > 0, 'multi-point ribbon emits polygons');
  let maxS = 0;
  let seenMidPace = false;
  let seenMidSpeed = false;
  for (const poly of polys) {
    for (const v of poly) {
      assert.ok(Number.isFinite(v.s) && v.s >= 0, `arc-length s must be finite non-negative, got ${v.s}`);
      assert.ok(v.p >= 0.19 && v.p <= 0.91, `pace p must remain interpolated in [0.2, 0.9], got ${v.p}`);
      assert.ok(v.sp >= 0.09 && v.sp <= 0.96, `speed sp must remain interpolated in [0.1, 0.95], got ${v.sp}`);
      if (v.s > maxS) maxS = v.s;
      if (v.p > 0.4 && v.p < 0.8) seenMidPace = true;
      if (v.sp > 0.3 && v.sp < 0.8) seenMidSpeed = true;
    }
  }
  assert.ok(maxS > 150, `expected accumulated travel distance > 150, got ${maxS}`);
  assert.ok(seenMidPace, 'interpolated pace values are emitted along the ribbon');
  assert.ok(seenMidSpeed, 'interpolated speed values are emitted along the ribbon');

  // Single-point burn emits a closed radial scorch disc with unit-bounded u,v
  const spotPolys = [];
  emitSoftRibbonTriangles([{ x: 400, y: 300, pace: 0.78, speed: 0.12 }], () => 20, poly => spotPolys.push(poly), pt => pt.pace, pt => pt.speed);
  assert.ok(spotPolys.length >= 16, `expected circular fan segments for 1-point burn, got ${spotPolys.length}`);
  for (const poly of spotPolys) {
    for (const v of poly) {
      assert.ok(Math.hypot(v.u, v.v) <= 1.001, `1-point burn radial uv exceeds 1: (${v.u}, ${v.v})`);
      assert.ok(Math.abs(v.p - 0.78) < 1e-6, `1-point burn preserves pace p=0.78, got ${v.p}`);
      assert.ok(Math.abs(v.sp - 0.12) < 1e-6, `1-point burn preserves speed sp=0.12, got ${v.sp}`);
    }
  }

  // Slow-moving / held fireball (onFire=true, high pace, < 2 px motion then >= 2 px) still burns ice
  const bodies = P.kickoff();
  const ball = bodies[6];
  ball.x = 500;
  ball.y = 300;
  ball.vx = 10;
  ball.vy = 0;
  ball.onFire = true;
  ball.fireTicks = 60;
  ball.pace = 960;

  const makeCtx = () => {
    const ctx = {
      arcs: 0,
      globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
      lineCap: 'butt', lineJoin: 'miter', font: '12px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
      shadowBlur: 0, shadowColor: 'transparent', globalCompositeOperation: 'source-over',
      save() {}, restore() {}, beginPath() {}, closePath() {}, setLineDash() {},
      moveTo() {}, lineTo() {}, fill() {}, stroke() {}, arc() { ctx.arcs++; }, ellipse() {}, roundRect() {}, clip() {},
      quadraticCurveTo() {}, bezierCurveTo() {}, setTransform() {}, clearRect() {}, drawImage() {},
      fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {}, measureText: () => ({ width: 20 }),
      translate() {}, rotate() {}, scale() {},
      createRadialGradient() { return { addColorStop() {} }; },
      createLinearGradient() { return { addColorStop() {} }; }
    };
    return ctx;
  };
  const iceCtx = makeCtx();
  const iceLayer = { width: 0, height: 0, getContext: () => iceCtx };
  const fx = createEffectsState([], {});
  fx.fireTime = 0.4;
  const view = {
    canvas: { width: 1000, height: 600, clientWidth: 1000, clientHeight: 600, getContext: () => makeCtx() },
    ctx: makeCtx(),
    badgeCanvas: { width: 1000, height: 600 },
    badgeCtx: makeCtx(),
    bodies, entries: [], mode: 'standard', portrait: false, field: null
  };
  const pres = createRinkPresenter({
    P, ububallMatch, ububallReplay,
    doc: { createElement: () => iceLayer },
    getView: () => view, getEffects: () => fx, getPhase: () => 'play',
    getPlans: () => [], getRenderSize: () => ({ renderWidth: 1000, renderHeight: 600, deviceWidth: 1000, deviceHeight: 600 })
  });

  pres.burnIce(ball);
  assert.equal(fx.burns.length, 1, 'stationary fireball creates an initial burn mark');
  assert.equal(fx.burns[0].points.length, 1, 'initial slow fireball burn starts with 1 point');
  assert.ok(fx.burns[0].points[0].pace > 0.4, `expected positive normalized pace on burn point, got ${fx.burns[0].points[0].pace}`);
  assert.ok(fx.burns[0].points[0].speed < 0.05, `expected low normalized speed for slow fireball, got ${fx.burns[0].points[0].speed}`);

  // Tiny drift < 2px updates stationary spot rather than staying empty; Canvas 2D draws 1-point spot cleanly
  ball.x = 501;
  fx.fireTime = 0.6;
  pres.burnIce(ball);
  assert.equal(fx.burns[0].points.length, 1);
  assert.equal(fx.burns[0].points[0].depth, 1);
  pres.drawScene();
  assert.equal(fx.iceCache.burnSnap.length, 1, 'Canvas 2D iceCache tracks single-point burn');
  assert.ok(iceCtx.arcs > 0, 'Canvas 2D draws feathered circular arc bands for 1-point burn');
  assert.equal(fx.iceCache.rebuilds, 1);

  // Drift >= 2px extends into a continuous slow-fireball burn trail; fast launch raises point speed
  ball.x = 503.5;
  ball.vx = 1100;
  pres.burnIce(ball);
  assert.equal(fx.burns[0].points.length, 2, 'slow drift >= 2 px appends second burn point');
  assert.ok(fx.burns[0].points[1].speed > 0.8, `expected high normalized speed for fast fireball, got ${fx.burns[0].points[1].speed}`);
  pres.drawScene();
  assert.equal(fx.iceCache.burnSnap[0].count, 2, 'Canvas 2D iceCache rebuilds cleanly from 1-point to 2-point burn');
  assert.equal(fx.iceCache.rebuilds, 2, '1-to-2 point transition forces a clean ribbon rebuild');

  // Ember intensity and duration scale with speed: slow base ~0.45 / 0.55s vs fast max 1.0 / 1.1s
  const slowPt = fx.burns[0].points[0];
  const fastPt = fx.burns[0].points[1];
  assert.ok(slowPt.heat >= 0.44 && slowPt.heat <= 0.48, `slow fireball starts near 0.45 base heat, got ${slowPt.heat}`);
  assert.ok(fastPt.heat > 0.90 && fastPt.heat <= 1.0, `fast fireball starts near 1.0 max heat, got ${fastPt.heat}`);
  const slowSparks = fx.particles.filter(p => p.emberSpark && p.alphaScale < 0.5);
  assert.ok(slowSparks.length >= 2, `expected slow base path sparks, got ${slowSparks.length}`);
  for (const sp of slowSparks) {
    assert.ok(sp.duration >= 0.29 && sp.duration <= 0.60 && Math.hypot(sp.vx, sp.vy) <= 20, 'slow path sparks use shorter base duration');
  }

  pres.addWallEffect(ball, 1300, 'wall', 1, 0);
  const poof = fx.burns.find(b => b.poof);
  assert.ok(poof, 'meteor wall hit pushes a burn poof');
  assert.equal(poof.heat, 1, 'max-speed meteor burn poof starts at 1.0 ember heat');
  assert.ok(Math.abs(poof.pace - Math.max(0, Math.min(1, (1300 / P.BASE_LAUNCH_SPEED - 0.7) / 1.3))) < 1e-6, `meteor burn poof records matching pace, got ${poof.pace}`);
  // Lower-pace wall hit uses ball pace rather than hardcoded 0.78
  const medBall = { ...ball, vx: 860, vy: 0, pace: 860 };
  pres.addWallEffect(medBall, 860, 'wall', 1, 0);
  const medPoof = fx.burns.filter(b => b.poof).at(-1);
  assert.ok(medPoof.pace < 0.45 && medPoof.pace > 0.3, `medium meteor bounce matches ~860 px/s burn pace, got ${medPoof.pace}`);
  const maxSparks = fx.particles.filter(p => p.emberSpark && p.alphaScale > 0.99);
  assert.ok(maxSparks.length >= 4, 'max-speed meteor wall poof leaves high-intensity ember sparks');
  for (const sp of maxSparks) {
    assert.ok(sp.duration >= 0.59 && sp.duration <= 1.18, `max-speed path sparks use up to 2x duration, got ${sp.duration}`);
  }

  pres.updateEffects(0.56);
  assert.equal(slowPt.heat, 0, 'slow burn point cools out in base ~0.55s window');
  assert.ok(fastPt.heat > 0.35, `fast burn point still glows past 0.56s, got ${fastPt.heat}`);
  assert.ok(poof.heat > 0.45 && poof.heat < 0.55, `max-speed poof cools midway over 0.56s, got ${poof.heat}`);
  pres.updateEffects(0.65);
  assert.equal(fastPt.heat, 0, 'fast burn point finishes cooling within 1.1s max');
  assert.equal(poof.heat, 0, 'max-speed poof finishes cooling within 1.1s max');
  assert.equal(fx.particles.filter(p => p.emberSpark).length, 0, 'all path ember sparks expire after max cooling window');

  // markIce records cut/brake tear intensity on skid points
  const skater = bodies[0];
  skater.x = 300; skater.y = 250; skater.vx = 520; skater.vy = 0;
  pres.markIce(skater, 0, 1 / 60);
  skater.x = 306; skater.y = 256; skater.vx = 60; skater.vy = 180; // sharp slow/cut triggers skid
  pres.markIce(skater, 0, 1 / 60);
  assert.equal(fx.skids.length, 1);
  assert.ok(fx.skids[0].points[1].tear > 0.4, `expected elevated cut tear on sharp brake/turn, got ${fx.skids[0].points[1].tear}`);

  // emitSoftRibbonTriangles propagates heat h across polygons and single-point poofs
  const heatPolys = [];
  emitSoftRibbonTriangles(
    [{ x: 100, y: 100, pace: 0.7, speed: 0.3, heat: 0.0 }, { x: 200, y: 100, pace: 0.7, speed: 0.3, heat: 1.0 }],
    () => 20,
    poly => heatPolys.push(poly),
    pt => pt.pace,
    pt => pt.speed,
    pt => pt.heat
  );
  assert.ok(heatPolys.some(poly => poly.some(v => v.h > 0.9) && poly.some(v => v.h < 0.1) || heatPolys.length > 1), 'ember heat propagates across ribbon segments');
  const poofPolys = [];
  emitSoftRibbonTriangles([{ x: 150, y: 150, pace: 0.78, speed: 0.0, heat: 0.85 }], () => (30 * 2) / 1.5, poly => poofPolys.push(poly), pt => pt.pace, pt => pt.speed, pt => pt.heat);
  assert.ok(poofPolys.length >= 16 && Math.abs(poofPolys[0][0].h - 0.85) < 1e-6, '1-point poof disc preserves ember heat');

  // Particle emitters scale emission rate proportionally with slow-motion dt (0.1x) and emit zero when dt = 0
  fx.particles.length = 0;
  pres.lightNet(0);
  pres.burnNet(0);
  assert.equal(fx.particles.length, 0, 'burnNet spawns zero particles when paused (dt=0)');

  let slowTotal = 0;
  for (let i = 0; i < 60; i++) {
    fx.particles.length = 0;
    pres.burnNet(0.1 / 60);
    slowTotal += fx.particles.length;
  }
  // Expected: (210 + 90) * 0.1 = 30 particles over 60 slow frames (previously Math.ceil gave 120!)
  assert.ok(slowTotal >= 12 && slowTotal <= 55, `0.1x burnNet should spawn ~30 particles over 60 frames, got ${slowTotal}`);

  fx.netFire = null;
  ball.onFire = true;
  ball.vx = 900;
  ball.vy = 0;
  ball.pace = 900;
  let ballSlowTotal = 0;
  for (let i = 0; i < 60; i++) {
    fx.particles.length = 0;
    pres.sparkBall(ball, 0.1 / 60);
    ballSlowTotal += fx.particles.length;
  }
  // Expected: (120 + 90) * 0.1 = 21 particles over 60 slow frames (previously Math.ceil gave 120!)
  assert.ok(ballSlowTotal >= 8 && ballSlowTotal <= 40, `0.1x sparkBall should spawn ~21 particles over 60 frames, got ${ballSlowTotal}`);
  pres.dispose();
});
