/* Local full-presenter comparison harness (excluded from public deployment assets). */
(async function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const P = ububallPhysics;
  const { createEffectsState, createMaterialEmitters, MATERIAL_STYLES, mountSkaterSprites, createRinkPresenter } = ububallPresentation;

  // Shared benchmark flag bag so Heat Mirage toggle applies identically to both renderers
  const bench = window.__ubuBench = { flags: {}, rec: null };

  // Build 6 deterministic ubus with rare materials & supers
  const entries = [];
  let seed = 734;
  const nextByte = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 24) & 0xff; };
  for (let i = 0; i < 6; i++) {
    let bytes, model;
    for (let tries = 0; tries < 300; tries++) {
      bytes = Uint8Array.from({ length: 128 }, nextByte);
      model = ubu.decode(bytes);
      if (i % 2 === 0 && Object.values(model.attributes || {}).some(a => a?.material && a.material !== 'matte')) break;
      if (i % 2 === 1) break;
    }
    const superObj = P.SUPERS[(i * 2 + 1) % P.SUPERS.length];
    entries.push({
      key: 'lab-' + i,
      dna: ubu.toCode(bytes),
      label: model.parts.fullName,
      model,
      equippedSuper: { ...superObj, ...P.superMastery(model.supers, superObj.id) }
    });
  }
  const stats = entries.map(e => ({ ...e.model.stats }));

  let simBodies = P.kickoff();
  let play = ububallMatch.newPlay();
  let tally = ububallMatch.newTally();
  let fouls = ububallMatch.newFouls();
  let clockMs = 1000;
  let elapsed = 0;
  let acc = 0;
  let paused = false;
  let heatEnabled = true;
  let mode = 0; // 0 = Both, 1 = Canvas 2D solo, 2 = WebGL2 solo
  let warpScale = Number($('strength')?.value ?? 1);
  let density = Number($('resolution').value) || 1.5;

  function makeSide(canvasId, wrapId, skatersId, forceCanvas2D) {
    const canvas = $(canvasId);
    const wrap = $(wrapId);
    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.className = 'field-badges';
    badgeCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    wrap.append(badgeCanvas);

    const view = {
      canvas,
      ctx: forceCanvas2D ? canvas.getContext('2d') : null,
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
    const fx = createEffectsState(entries, MATERIAL_STYLES);
    let skaters = [];

    const presenter = createRinkPresenter({
      P,
      ububallMatch,
      ububallReplay,
      forceCanvas2D,
      enableGpuTimer: !forceCanvas2D,
      getView: () => view,
      getEffects: () => fx,
      getPhase: () => 'play',
      getPlans: () => [],
      getElapsed: () => elapsed,
      getFouls: () => fouls,
      isMoving: () => !paused,
      getSkaters: () => skaters,
      getRinkWrap: () => wrap,
      getRenderSize: () => ({
        renderWidth: wrap.clientWidth || 1000,
        renderHeight: wrap.clientHeight || 600,
        deviceWidth: view._overrideW || Math.round(1000 * density),
        deviceHeight: view._overrideH || Math.round(600 * density),
        visibleRinkHeight: 600
      }),
      isReducedMotion: () => false,
      clockNow: () => clockMs,
      gameAudio: () => null,
      onAssetLoad: () => { if (paused) renderOnce(); }
    });

    skaters = mountSkaterSprites($(skatersId), entries, ubuRender, () => { if (paused) renderOnce(); });
    return { view, fx, presenter, get skaters() { return skaters; }, submitSamples: [] };
  }

  function syncBodiesToView(target) {
    for (let i = 0; i < 7; i++) {
      Object.assign(target[i], simBodies[i]);
      if (i < 6) {
        target[i].equippedSuper = entries[i].equippedSuper;
        target[i].name = entries[i].model.parts.fullName;
      }
    }
  }

  let cpuSide, gpuSide;
  const frameIntervals = [];
  let priorFrameAt = 0, lastFrameAt = 0, lastStatsAt = 0;

  function makeSeededRng(s0) {
    let s = s0 >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }

  function withDetRandom(seedVal, fn) {
    const orig = Math.random;
    Math.random = makeSeededRng(seedVal);
    try { return fn(); } finally { Math.random = orig; }
  }

  let rngStepCounter = 1;

  function resetShot() {
    rngStepCounter = 1;
    simBodies = P.kickoff();
    const coords = [[300, 245], [335, 355], [245, 300], [700, 250], [665, 350], [755, 300]];
    simBodies.slice(0, 6).forEach((b, i) => {
      b.x = coords[i][0]; b.y = coords[i][1];
      ububallMatch.applyStats(P, b, stats[i], 'standard');
      b.meter = 100;
      b.equippedSuper = entries[i].equippedSuper;
    });
    const plans = [
      { angle: 0.14, power: 1.0, spin: 0.9, guard: false, superArm: true },
      { angle: -0.20, power: 0.95, spin: -0.85, guard: false, superArm: true },
      { angle: 0.02, power: 0.9, spin: 0.75, guard: false, superArm: false },
      { angle: Math.PI - 0.14, power: 1.0, spin: -0.9, guard: false, superArm: true },
      { angle: Math.PI + 0.20, power: 0.9, spin: 0.8, guard: false, superArm: false },
      { angle: Math.PI, power: 0.85, spin: 0, guard: true, superArm: false }
    ];
    play = ububallMatch.newPlay();
    tally = ububallMatch.newTally();
    fouls = ububallMatch.newFouls();
    elapsed = 0;
    acc = 0;

    for (const side of [cpuSide, gpuSide]) {
      if (!side) continue;
      syncBodiesToView(side.view.bodies);
      side.presenter.clearEffects();
    }

    P.startTurn(simBodies, plans, (key, stage, body, target) => {
      const idx = simBodies.indexOf(body);
      const tIdx = target ? simBodies.indexOf(target) : -1;
      for (const [k, side] of [[0, cpuSide], [1, gpuSide]]) {
        syncBodiesToView(side.view.bodies);
        withDetRandom(9000 + idx * 17 + k * 0, () => {
          side.presenter.handleSuper(key, stage, side.view.bodies[idx], tIdx >= 0 ? side.view.bodies[tIdx] : null);
        });
      }
    }, (body, idx, kind, pvx, pvy, vx, vy, strength) => {
      for (const side of [cpuSide, gpuSide]) {
        syncBodiesToView(side.view.bodies);
        withDetRandom(9500 + idx * 19, () => {
          side.presenter.handleLaunch?.(side.view.bodies[idx], idx, kind, pvx, pvy, vx, vy, strength);
        });
      }
    });

    const ball = simBodies[6];
    ball.x = 410; ball.y = 295;
    ball.vx = 840; ball.vy = -210; ball.omega = 18;
    ball.onFire = true; ball.fireTicks = 900; ball.pace = 960; ball.strikerTeam = 0;

    for (const side of [cpuSide, gpuSide]) {
      syncBodiesToView(side.view.bodies);
      side.fx.fireWarp = { x: ball.x, y: ball.y, nx: -1, ny: 0.25, life: 0.30, duration: 0.30, ubuIndex: 0 };
    }
  }

  function stepSharedWorld(dt) {
    if (dt <= 0) return;
    clockMs += dt * 1000;
    elapsed += dt;
    acc += dt;
    const fxHooks = {
      collide: contact => {
        const ia = simBodies.indexOf(contact.a), ib = simBodies.indexOf(contact.b);
        const sSeed = 10000 + (rngStepCounter++);
        for (const side of [cpuSide, gpuSide]) {
          syncBodiesToView(side.view.bodies);
          withDetRandom(sSeed, () => {
            side.presenter.handleCollision({ ...contact, a: side.view.bodies[ia], b: side.view.bodies[ib] });
          });
        }
      },
      wall: (body, vel, wType, nx, ny, rimmed, spinBite = 0, counterScuff = 0) => {
        const ib = simBodies.indexOf(body);
        const sSeed = 20000 + (rngStepCounter++);
        for (const side of [cpuSide, gpuSide]) {
          syncBodiesToView(side.view.bodies);
          withDetRandom(sSeed, () => {
            side.presenter.handleWall(side.view.bodies[ib], vel, wType, nx, ny, rimmed, spinBite, counterScuff);
          });
        }
      },
      shockwave: (src, rad, type) => {
        const isrc = simBodies.indexOf(src);
        const sSeed = 30000 + (rngStepCounter++);
        for (const side of [cpuSide, gpuSide]) {
          syncBodiesToView(side.view.bodies);
          withDetRandom(sSeed, () => {
            side.presenter.handleShockwave(side.view.bodies[isrc], rad, type);
          });
        }
      },
      super: (key, stage, body, target) => {
        const ib = simBodies.indexOf(body), it = target ? simBodies.indexOf(target) : -1;
        const sSeed = 40000 + (rngStepCounter++);
        for (const side of [cpuSide, gpuSide]) {
          syncBodiesToView(side.view.bodies);
          withDetRandom(sSeed, () => {
            side.presenter.handleSuper(key, stage, side.view.bodies[ib], it >= 0 ? side.view.bodies[it] : null);
          });
        }
      }
    };

    let goalScored = null;
    while (acc >= P.DT) {
      acc -= P.DT;
      const tick = ububallMatch.playTick(P, simBodies, play, fxHooks, tally);
      for (const side of [cpuSide, gpuSide]) {
        syncBodiesToView(side.view.bodies);
        side.presenter.recordTrails();
      }
      if (tick.goal !== null) { goalScored = tick.goal; break; }
    }

    // Keep fireball burning across demo loops so continuous refraction + burn ribbons stay active
    simBodies[6].onFire = true;
    simBodies[6].fireTicks = Math.max(simBodies[6].fireTicks || 0, 300);
    simBodies[6].pace = Math.max(simBodies[6].pace || 0, 900);

    const emitSeed = 50000 + (rngStepCounter++);
    for (const side of [cpuSide, gpuSide]) {
      syncBodiesToView(side.view.bodies);
      withDetRandom(emitSeed, () => {
        if (goalScored !== null) side.presenter.celebrate(goalScored, side.view.bodies[6], 'FIREBALL!', side.view.bodies[0]);
        side.presenter.emitSkaterEffects(dt);
        side.presenter.updatePopups(dt);
        side.presenter.updateEffects(dt);
      });
    }

    if (elapsed > 5.5 || P.settled(simBodies) || goalScored !== null) {
      if (goalScored === null) resetShot();
      else if (elapsed > 6.8) resetShot();
    }
  }

  function clearStats() {
    cpuSide.submitSamples.length = 0;
    gpuSide.submitSamples.length = 0;
    frameIntervals.length = 0;
    priorFrameAt = 0;
  }

  function renderOnce() {
    bench.flags.noMirage = !heatEnabled || warpScale <= 0;
    bench.warpScale = warpScale;
    const w = Math.round(1000 * density), h = Math.round(600 * density);
    for (const [idx, side] of [[0, cpuSide], [1, gpuSide]]) {
      if ((mode === 1 && idx === 1) || (mode === 2 && idx === 0)) continue;
      const t0 = performance.now();
      side.presenter.drawScene();
      const dt = performance.now() - t0;
      side.submitSamples.push(dt);
      if (side.submitSamples.length > 240) side.submitSamples.shift();
    }
  }

  function pct(arr, q) {
    if (!arr.length) return '-';
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2);
  }

  function updateReadouts() {
    const w = Math.round(1000 * density), h = Math.round(600 * density);
    const f50 = pct(frameIntervals, 0.5), f95 = pct(frameIntervals, 0.95);
    $('cpu-stats').textContent =
      `Submit p50 ${pct(cpuSide.submitSamples, 0.5)} ms (p95 ${pct(cpuSide.submitSamples, 0.95)} ms) | ` +
      `Frame p50 ${f50} ms / p95 ${f95} ms | ${w}x${h} (Canvas 2D + DOM skaters)`;
    const rInfo = gpuSide.presenter.getRendererInfo();
    const gpuStr = rInfo.gpuMs != null ? ` | GPU timer ${rInfo.gpuMs.toFixed(2)} ms` : '';
    $('gpu-stats').textContent =
      `Submit p50 ${pct(gpuSide.submitSamples, 0.5)} ms (p95 ${pct(gpuSide.submitSamples, 0.95)} ms)${gpuStr} | ` +
      `Frame p50 ${f50} ms / p95 ${f95} ms | ${rInfo.drawCalls} draws, ${rInfo.textures} tex | ${w}x${h} (${rInfo.backend.toUpperCase()})`;
  }

  function frame(now) {
    if (paused) return;
    const dt = lastFrameAt ? Math.min(0.05, (now - lastFrameAt) / 1000) : (1 / 60);
    lastFrameAt = now;
    if (priorFrameAt) {
      frameIntervals.push(now - priorFrameAt);
      if (frameIntervals.length > 240) frameIntervals.shift();
    }
    priorFrameAt = now;
    stepSharedWorld(dt);
    renderOnce();
    if (now - lastStatsAt > 400) {
      updateReadouts();
      lastStatsAt = now;
    }
    requestAnimationFrame(frame);
  }

  try {
    cpuSide = makeSide('cpu', 'cpu-wrap', 'cpu-skaters', true);
    gpuSide = makeSide('gpu', 'gpu-wrap', 'gpu-skaters', false);
    await Promise.all([
      cpuSide.presenter.ensureEntrySprites(entries),
      gpuSide.presenter.ensureEntrySprites(entries)
    ]);
    resetShot();
    stepSharedWorld(0.25);
    renderOnce();
    updateReadouts();

    if ($('strength')) {
      $('strength').oninput = () => {
        warpScale = Number($('strength').value);
        $('strength-val').textContent = warpScale.toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1') + 'x';
        clearStats();
        renderOnce();
        updateReadouts();
      };
    }
    $('resolution').oninput = () => {
      density = Number($('resolution').value) || 1.5;
      $('density').textContent = density + 'x';
      clearStats();
      renderOnce();
      updateReadouts();
    };
    $('pause').onclick = () => {
      paused = !paused;
      $('pause').textContent = paused ? 'Resume' : 'Pause';
      lastFrameAt = 0;
      if (!paused) requestAnimationFrame(frame);
      else { renderOnce(); updateReadouts(); }
    };
    $('step').onclick = () => {
      paused = true;
      $('pause').textContent = 'Resume';
      stepSharedWorld(1 / 60);
      renderOnce();
      updateReadouts();
    };
    $('restart').onclick = () => {
      resetShot();
      renderOnce();
      updateReadouts();
    };
    $('heat').onclick = () => {
      heatEnabled = !heatEnabled;
      $('heat').setAttribute('aria-pressed', String(heatEnabled));
      clearStats();
      renderOnce();
      updateReadouts();
    };
    $('mode').onclick = () => {
      mode = (mode + 1) % 3;
      $('mode').textContent = 'View: ' + ['Both', 'Canvas 2D', 'WebGL2'][mode];
      $('reference').hidden = mode === 2;
      $('gpu-panel').hidden = mode === 1;
      document.querySelector('.stages').classList.toggle('solo', mode !== 0);
      clearStats();
      renderOnce();
      updateReadouts();
    };

    let lostExt = null, isSimLost = false;
    $('lose-ctx').onclick = () => {
      const gl = gpuSide.view._webgl?.gl;
      if (!gl && !lostExt) return;
      lostExt ||= gl.getExtension('WEBGL_lose_context');
      if (!lostExt) { $('status').textContent = 'WEBGL_lose_context extension unavailable.'; return; }
      if (!isSimLost) {
        isSimLost = true;
        lostExt.loseContext();
        $('lose-ctx').textContent = 'Restore context';
        $('status').textContent = 'Simulated WebGL2 context loss: Canvas 2D fallback active while awaiting restoration.';
        renderOnce();
        updateReadouts();
      } else {
        isSimLost = false;
        lostExt.restoreContext();
        $('lose-ctx').textContent = 'Test context loss';
        setTimeout(() => {
          renderOnce();
          updateReadouts();
          $('status').textContent = 'WebGL2 context restored cleanly; GPU scene rendering resumed.';
        }, 80);
      }
    };

    window.addEventListener('pagehide', () => {
      cpuSide.presenter.dispose();
      gpuSide.presenter.dispose();
    }, { once: true });

    $('status').textContent = 'Ready · Full production presenter running identically in Canvas 2D and WebGL2.';
    requestAnimationFrame(frame);

    window.webglDemo = {
      cpuSide,
      gpuSide,
      get bodies() { return simBodies; },
      get heatEnabled() { return heatEnabled; },
      setHeat(v) { heatEnabled = Boolean(v); $('heat').setAttribute('aria-pressed', String(heatEnabled)); renderOnce(); },
      setPaused(v) { paused = Boolean(v); $('pause').textContent = paused ? 'Resume' : 'Pause'; if (!paused) requestAnimationFrame(frame); },
      stepSharedWorld,
      render: renderOnce,
      resetShot
    };
  } catch (err) {
    $('status').textContent = err.message;
    console.error(err);
  }
})();
