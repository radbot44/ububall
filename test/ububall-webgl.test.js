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

test('exporting videoFrame views enable preserveDrawingBuffer, disable alpha, and composite scorebug in one WebGL2 pass', () => {
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
  assert.equal(expCanvas._mockGl.contextAttrs.preserveDrawingBuffer, true, 'export canvas enables preserveDrawingBuffer');
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
