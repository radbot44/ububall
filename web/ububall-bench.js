/* On-device visual & main-thread ablation benchmark suite (loaded only when ?bench=1). */
(function (root) {
  'use strict';

  const bench = root.__ubuBench;
  if (!bench || !bench.control) return;

  const TOGGLE_DEFS = [
    { key: 'dprCap', value: 2, label: 'DPR <= 2.0' },
    { key: 'dprCap', value: 1.5, label: 'DPR <= 1.5' },
    { key: 'dprCap', value: 1, label: 'DPR <= 1.0' },
    { key: 'noMirage', value: true, label: 'No Heat Mirage' },
    { key: 'freezeIceKey', value: true, label: 'Freeze Ice Cache' },
    { key: 'noIceShadow', value: true, label: 'No Ice ShadowBlur' },
    { key: 'noGlowBlur', value: true, label: 'No Glow Blur' },
    { key: 'noSpin', value: true, label: 'No Spin Arcs' },
    { key: 'noTrails', value: true, label: 'No Trails' },
    { key: 'noParticles', value: true, label: 'No Particles' },
    { key: 'noDomSkaters', value: true, label: 'Hide DOM Skaters' },
    { key: 'noAudio', value: true, label: 'No Web Audio' },
    { key: 'noPredictLayer', value: true, label: 'No Predict Layer' },
    { key: 'noPredictAll', value: true, label: 'No Prediction' },
    { key: 'noCollectionScrollDraw', value: true, label: 'No Scroll Rink Draw' }
  ];

  const SUITE_PASSES = [
    { id: '01_calm_3v3', group: 'play', title: 'Calm 3v3 glide (reference)', scenario: 'calm', flags: {}, frames: 90 },
    { id: '02_chaos_baseline', group: 'chaos', title: 'Chaos full baseline (all FX on)', scenario: 'chaos', flags: {}, frames: 110, baseline: true },
    { id: '03_chaos_dpr_2.0', group: 'chaos', title: 'Chaos + DPR cap 2.0', scenario: 'chaos', flags: { dprCap: 2 }, frames: 100 },
    { id: '04_chaos_dpr_1.5', group: 'chaos', title: 'Chaos + DPR cap 1.5', scenario: 'chaos', flags: { dprCap: 1.5 }, frames: 100 },
    { id: '05_chaos_dpr_1.0', group: 'chaos', title: 'Chaos + DPR cap 1.0', scenario: 'chaos', flags: { dprCap: 1 }, frames: 100 },
    { id: '06_chaos_no_mirage', group: 'chaos', title: 'Chaos - Heat Mirage (self-copy)', scenario: 'chaos', flags: { noMirage: true }, frames: 100 },
    { id: '07_chaos_freeze_ice', group: 'chaos', title: 'Chaos - Ice Cache per-frame bust', scenario: 'chaos', flags: { freezeIceKey: true }, frames: 100 },
    { id: '08_chaos_no_ice_shadow', group: 'chaos', title: 'Chaos - Ice 4000px shadowBlur', scenario: 'chaos', flags: { noIceShadow: true }, frames: 100 },
    { id: '09_chaos_no_glow_blur', group: 'chaos', title: 'Chaos - Live glow shadowBlur', scenario: 'chaos', flags: { noGlowBlur: true }, frames: 100 },
    { id: '10_chaos_no_spin', group: 'chaos', title: 'Chaos - Tapered spin gradients', scenario: 'chaos', flags: { noSpin: true }, frames: 100 },
    { id: '11_chaos_no_trails', group: 'chaos', title: 'Chaos - Multi-stop trails', scenario: 'chaos', flags: { noTrails: true }, frames: 100 },
    { id: '12_chaos_no_particles', group: 'chaos', title: 'Chaos - Particles & sparks', scenario: 'chaos', flags: { noParticles: true }, frames: 100 },
    { id: '13_chaos_no_dom_skaters', group: 'chaos', title: 'Chaos - #skaters DOM layer', scenario: 'chaos', flags: { noDomSkaters: true }, frames: 100 },
    { id: '14_chaos_no_audio', group: 'chaos', title: 'Chaos - Web Audio synth', scenario: 'chaos', flags: { noAudio: true }, frames: 100 },
    { id: '15_chaos_combo_fast', group: 'chaos', title: 'Chaos combo (noMirage + freezeIce + DPR<=2)', scenario: 'chaos', flags: { noMirage: true, freezeIceKey: true, dprCap: 2 }, frames: 100 },
    { id: '16_celebration_replay', group: 'replay', title: 'Goal celebration + slow-mo replay', scenario: 'celebration', flags: {}, frames: 100, baseline: true },
    { id: '17_celebration_lite', group: 'replay', title: 'Goal replay - Particles & Mirage', scenario: 'celebration', flags: { noParticles: true, noMirage: true, freezeIceKey: true }, frames: 100 },
    { id: '18_aim_drag_baseline', group: 'plan', title: 'Aim drag (predictTurn + layer paint)', scenario: 'aimDrag', flags: {}, frames: 90, baseline: true },
    { id: '19_aim_drag_no_layer', group: 'plan', title: 'Aim drag - Skip predictionLayer paint', scenario: 'aimDrag', flags: { noPredictLayer: true }, frames: 90 },
    { id: '20_aim_drag_no_predict', group: 'plan', title: 'Aim drag - Skip all prediction', scenario: 'aimDrag', flags: { noPredictAll: true }, frames: 90 },
    { id: '21_spin_slider_turn30', group: 'plan', title: 'Spin slider drag @ Turn 30 (coalesced)', scenario: 'spinSlider', flags: {}, frames: 90 },
    { id: '22_collection_cold_60', group: 'collection', title: 'Collection 60-ubu cold sprite bake', scenario: 'collectionCold', flags: {}, frames: 80, baseline: true },
    { id: '23_collection_warm_scroll', group: 'collection', title: 'Collection warm scroll (default)', scenario: 'collectionWarm', flags: {}, frames: 80 },
    { id: '24_collection_scroll_no_rink', group: 'collection', title: 'Collection warm scroll - Skip rink redraw', scenario: 'collectionWarm', flags: { noCollectionScrollDraw: true }, frames: 80 }
  ];

  function percentile(sorted, q) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  }

  function summarizePass(pass, rec, state, longTasks) {
    const frames = rec.frames.slice().sort((a, b) => a - b);
    const n = Math.max(1, frames.length);
    const sum = frames.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const jsTotal = (rec.simMs + rec.drawMs + rec.syncMs) / n;
    return {
      id: pass.id,
      group: pass.group,
      title: pass.title,
      flags: { ...pass.flags },
      frames: frames.length,
      p50: +percentile(frames, 0.5).toFixed(2),
      p95: +percentile(frames, 0.95).toFixed(2),
      p99: +percentile(frames, 0.99).toFixed(2),
      max: +(frames[frames.length - 1] || 0).toFixed(2),
      mean: +mean.toFixed(2),
      approxHz: +(1000 / Math.max(0.1, mean)).toFixed(1),
      over8_3ms: frames.filter(x => x > 8.5).length,
      over16_7ms: frames.filter(x => x > 16.9).length,
      over8_3Pct: +((frames.filter(x => x > 8.5).length * 100) / n).toFixed(1),
      over16_7Pct: +((frames.filter(x => x > 16.9).length * 100) / n).toFixed(1),
      jsMeanMs: +jsTotal.toFixed(2),
      simMeanMs: +(rec.simMs / n).toFixed(2),
      drawJsMeanMs: +(rec.drawMs / n).toFixed(2),
      syncMeanMs: +(rec.syncMs / n).toFixed(2),
      predictSimMs: +(rec.predictSimMs / n).toFixed(2),
      predictPaintMs: +(rec.predictPaintMs / n).toFixed(2),
      nonJsFrameMs: +Math.max(0, mean - jsTotal).toFixed(2),
      longTasks: longTasks.count,
      longTaskMaxMs: +longTasks.max.toFixed(1),
      canvas: state.canvasW + 'x' + state.canvasH,
      cssRink: state.cssW + 'x' + state.cssH
    };
  }

  function formatMarkdownReport(report) {
    const lines = [
      '# Ububall On-Device Benchmark Report',
      '',
      '- **Timestamp**: ' + report.timestamp,
      '- **Viewport / DPR**: `' + report.device.innerW + 'x' + report.device.innerH + '` CSS @ DPR `' + report.device.dpr + '`',
      '- **Estimated Display Refresh**: `' + report.device.displayHz + ' Hz`',
      '- **Hardware Threads / Memory**: `' + (report.device.cores || '?') + '` cores' + (report.device.deviceMemoryGB ? ', `' + report.device.deviceMemoryGB + ' GB` class' : ''),
      '- **User Agent**: `' + report.device.userAgent + '`',
      '',
      '| Pass | Canvas Buffer | p50 (ms) | p95 (ms) | max (ms) | JS/f (ms) | DrawJS (ms) | >8.3ms % | >16.7ms % | Delta p95 |',
      '| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
    ];
    const baselines = {};
    for (const r of report.results) {
      if (r.id === '02_chaos_baseline' || r.id === '16_celebration_replay' || r.id === '18_aim_drag_baseline' || r.id === '22_collection_cold_60') {
        baselines[r.group] = r.p95;
      }
    }
    for (const r of report.results) {
      const base = baselines[r.group];
      const delta = (base !== undefined && r.p95 !== base)
        ? ((r.p95 - base) > 0 ? '+' : '') + (r.p95 - base).toFixed(2) + ' ms'
        : 'base';
      lines.push(
        '| `' + r.id + '` ' + r.title + ' | `' + r.canvas + '` | ' +
        r.p50.toFixed(2) + ' | **' + r.p95.toFixed(2) + '** | ' + r.max.toFixed(1) + ' | ' +
        r.jsMeanMs.toFixed(2) + ' | ' + r.drawJsMeanMs.toFixed(2) + ' | ' +
        r.over8_3Pct.toFixed(1) + '% | ' + r.over16_7Pct.toFixed(1) + '% | ' + delta + ' |'
      );
    }
    return lines.join('\n') + '\n';
  }

  // Inject self-contained workbench styles (only present when ?bench=1 loads this script)
  const style = document.createElement('style');
  style.textContent = [
    '.ubu-bench{position:fixed;right:.6rem;bottom:.6rem;z-index:9999;width:min(27rem,calc(100vw - 1.2rem));max-height:calc(100dvh - 1.2rem);display:flex;flex-direction:column;gap:.45rem;padding:.65rem .75rem;border-radius:.75rem;background:#10131ae8;border:1px solid #2d3444;color:#eef1f7;font:12px/1.38 ui-monospace,SFMono-Regular,Consolas,monospace;box-shadow:0 .5rem 1.8rem #000b;backdrop-filter:blur(8px)}',
    '.ubu-bench.running{width:auto;max-width:calc(100vw - 1.2rem);padding:.4rem .65rem;pointer-events:auto}',
    '.ubu-bench.running .ubu-bench-body{display:none}',
    '.ubu-bench.collapsed{width:auto;padding:.38rem .6rem}',
    '.ubu-bench.collapsed .ubu-bench-body{display:none}',
    '.ubu-bench-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem}',
    '.ubu-bench-title{font-weight:700;color:#8cc8ff;white-space:nowrap}',
    '.ubu-bench-live{color:#b9c2d3;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ubu-bench-body{display:flex;flex-direction:column;gap:.45rem;overflow:auto}',
    '.ubu-bench-row{display:flex;flex-wrap:wrap;gap:.35rem}',
    '.ubu-bench button{appearance:none;border:1px solid #364055;border-radius:.45rem;background:#1a202c;color:#eef1f7;padding:.3rem .52rem;font:inherit;cursor:pointer}',
    '.ubu-bench button:hover{background:#252e40;border-color:#4e5d7a}',
    '.ubu-bench button.primary{background:#1f5eff;border-color:#4b82ff;color:#fff;font-weight:700}',
    '.ubu-bench button.active{background:#2a4365;border-color:#63b3ed;color:#90cdf4}',
    '.ubu-bench-out{max-height:13rem;overflow:auto;padding:.45rem;border-radius:.45rem;background:#090b10;border:1px solid #232936;white-space:pre;font-size:11px;color:#d6deeb}'
  ].join('');
  document.head.append(style);

  const panel = document.createElement('section');
  panel.className = 'ubu-bench';
  panel.setAttribute('aria-label', 'Performance benchmark controls');

  const head = document.createElement('div');
  head.className = 'ubu-bench-head';
  const titleEl = document.createElement('span');
  titleEl.className = 'ubu-bench-title';
  titleEl.textContent = 'UBUBALL BENCH';
  const liveEl = document.createElement('span');
  liveEl.className = 'ubu-bench-live';
  liveEl.textContent = 'Measuring Hz...';
  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.textContent = 'Hide';
  collapseBtn.onclick = () => {
    const c = panel.classList.toggle('collapsed');
    collapseBtn.textContent = c ? 'Bench' : 'Hide';
  };
  head.append(titleEl, liveEl, collapseBtn);

  const body = document.createElement('div');
  body.className = 'ubu-bench-body';

  const actionRow = document.createElement('div');
  actionRow.className = 'ubu-bench-row';
  const runSuiteBtn = document.createElement('button');
  runSuiteBtn.type = 'button';
  runSuiteBtn.className = 'primary';
  runSuiteBtn.textContent = 'Run Full Suite (~45s)';
  const runChaosBtn = document.createElement('button');
  runChaosBtn.type = 'button';
  runChaosBtn.textContent = 'Quick Chaos A/B (~18s)';
  const resetFlagsBtn = document.createElement('button');
  resetFlagsBtn.type = 'button';
  resetFlagsBtn.textContent = 'Reset Toggles';
  actionRow.append(runSuiteBtn, runChaosBtn, resetFlagsBtn);

  const sceneRow = document.createElement('div');
  sceneRow.className = 'ubu-bench-row';
  for (const [label, fn] of [
    ['Scene: Chaos', () => bench.control.startScenario('chaos')],
    ['Scene: Replay', () => bench.control.startScenario('celebration')],
    ['Scene: Aim', () => bench.control.startScenario('aimDrag')]
  ]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = fn;
    sceneRow.append(b);
  }

  const toggleRow = document.createElement('div');
  toggleRow.className = 'ubu-bench-row';
  const chipButtons = [];

  function syncToggleButtons() {
    for (const item of chipButtons) {
      const on = bench.flags[item.def.key] === item.def.value;
      item.btn.classList.toggle('active', on);
    }
    const skatersEl = document.getElementById('skaters');
    if (skatersEl) skatersEl.style.display = bench.flags.noDomSkaters ? 'none' : '';
    bench.control.markDirty();
  }

  for (const def of TOGGLE_DEFS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = def.label;
    btn.onclick = () => {
      if (bench.flags[def.key] === def.value) delete bench.flags[def.key];
      else bench.flags[def.key] = def.value;
      syncToggleButtons();
    };
    chipButtons.push({ def, btn });
    toggleRow.append(btn);
  }

  resetFlagsBtn.onclick = () => {
    bench.flags = {};
    syncToggleButtons();
  };

  const exportRow = document.createElement('div');
  exportRow.className = 'ubu-bench-row';
  exportRow.hidden = true;
  const copyMdBtn = document.createElement('button');
  copyMdBtn.type = 'button';
  copyMdBtn.textContent = 'Copy Markdown';
  const copyJsonBtn = document.createElement('button');
  copyJsonBtn.type = 'button';
  copyJsonBtn.textContent = 'Copy JSON';
  const dlJsonBtn = document.createElement('button');
  dlJsonBtn.type = 'button';
  dlJsonBtn.textContent = 'Download JSON';
  exportRow.append(copyMdBtn, copyJsonBtn, dlJsonBtn);

  const outPre = document.createElement('pre');
  outPre.className = 'ubu-bench-out';
  outPre.hidden = true;

  body.append(actionRow, sceneRow, toggleRow, exportRow, outPre);
  panel.append(head, body);
  document.body.append(panel);

  // Rolling live HUD meter (updates once every 30 frames so it adds zero measurable overhead)
  let rolling = [], lastRollingAt = performance.now(), suiteBusy = false, estimatedHz = 60;
  function monitorTick(now) {
    const dt = now - lastRollingAt;
    lastRollingAt = now;
    if (!suiteBusy && dt > 0 && dt < 250) {
      rolling.push(dt);
      if (rolling.length >= 45) {
        const s = rolling.slice().sort((a, b) => a - b);
        const p50 = percentile(s, 0.5);
        const p95 = percentile(s, 0.95);
        const hz = Math.round(1000 / Math.max(1, p50));
        if (hz > estimatedHz && hz <= 240) estimatedHz = hz;
        const st = bench.control.getState();
        liveEl.textContent = `${st.canvasW}x${st.canvasH} | p50 ${p50.toFixed(1)}ms p95 ${p95.toFixed(1)}ms (~${hz}Hz)`;
        rolling.length = 0;
      }
    }
    requestAnimationFrame(monitorTick);
  }
  requestAnimationFrame(monitorTick);

  let lastReport = null, lastMarkdown = '';

  async function copyText(str) {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(str); return true; } catch {}
    }
    try {
      const ta = Object.assign(document.createElement('textarea'), { value: str });
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.append(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
  function postProgress(msg) {
    try { void fetch('/__bench_progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg }) }).catch(() => {}); } catch {}
  }
  window.addEventListener('error', e => {
    liveEl.textContent = 'ERR: ' + (e.message || 'script error');
    postProgress('ERROR: ' + (e.message || 'unknown') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
  });
  copyMdBtn.onclick = async () => {
    if (!lastMarkdown) return;
    if (await copyText(lastMarkdown)) { copyMdBtn.textContent = 'Copied MD!'; setTimeout(() => { copyMdBtn.textContent = 'Copy Markdown'; }, 1400); }
  };
  copyJsonBtn.onclick = async () => {
    if (!lastReport) return;
    if (await copyText(JSON.stringify(lastReport, null, 2))) { copyJsonBtn.textContent = 'Copied JSON!'; setTimeout(() => { copyJsonBtn.textContent = 'Copy JSON'; }, 1400); }
  };
  dlJsonBtn.onclick = () => {
    if (!lastReport) return;
    const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `ububall-bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  async function executeSuite(passes) {
    if (suiteBusy) return null;
    suiteBusy = true;
    panel.classList.remove('collapsed');
    panel.classList.add('running');
    collapseBtn.hidden = true;

    const longTaskState = { count: 0, max: 0 };
    let observer = null;
    if (typeof PerformanceObserver === 'function') {
      try {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            longTaskState.count++;
            if (entry.duration > longTaskState.max) longTaskState.max = entry.duration;
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch {}
    }

    let wakeLock = null;
    try { wakeLock = await navigator.wakeLock?.request?.('screen'); } catch {}
    postProgress(`Started suite (${passes.length} passes) on ${window.innerWidth}x${window.innerHeight} @ DPR ${window.devicePixelRatio || 1}`);
    const results = [];
    try {
      bench.control.prepareRoster();
      // Quick display refresh calibration (25 idle frames)
      const cal = [];
      let prev = performance.now();
      for (let i = 0; i < 25; i++) {
        const now = await new Promise(r => requestAnimationFrame(r));
        cal.push(now - prev);
        prev = now;
      }
      const calP50 = percentile(cal.sort((a, b) => a - b), 0.5);
      if (calP50 > 0) estimatedHz = Math.round(1000 / calP50);

      for (let idx = 0; idx < passes.length; idx++) {
        const pass = passes[idx];
        liveEl.textContent = `[${idx + 1}/${passes.length}] ${pass.id}...`;
        if (idx === 0 || (idx + 1) % 6 === 0 || idx === passes.length - 1) postProgress(`[${idx + 1}/${passes.length}] ${pass.id}`);
        bench.flags = { ...pass.flags };
        const skatersEl = document.getElementById('skaters');
        if (skatersEl) skatersEl.style.display = bench.flags.noDomSkaters ? 'none' : '';

        const stepHook = await bench.control.startScenario(pass.scenario);
        // Warmup 12 frames so canvas resize / initial caches settle
        for (let w = 0; w < 12; w++) {
          if (stepHook) stepHook(w);
          await new Promise(r => requestAnimationFrame(r));
        }

        longTaskState.count = 0;
        longTaskState.max = 0;
        const rec = bench.rec = {
          frames: [],
          simMs: 0,
          drawMs: 0,
          syncMs: 0,
          predictSimMs: 0,
          predictPaintMs: 0
        };

        prev = performance.now();
        for (let f = 0; f < pass.frames; f++) {
          if (stepHook) stepHook(f);
          const now = await new Promise(r => requestAnimationFrame(r));
          rec.frames.push(now - prev);
          prev = now;
        }
        bench.rec = null;
        results.push(summarizePass(pass, rec, bench.control.getState(), longTaskState));
      }
    } finally {
      try { await wakeLock?.release?.(); } catch {}
      if (observer) observer.disconnect();
      bench.flags = {};
      const skatersEl = document.getElementById('skaters');
      if (skatersEl) skatersEl.style.display = '';
      await bench.control.finishSuite();
      syncToggleButtons();
      panel.classList.remove('running');
      collapseBtn.hidden = false;
      suiteBusy = false;
    }

    const report = {
      schema: 'ububall-bench-v1',
      timestamp: new Date().toISOString(),
      device: {
        userAgent: navigator.userAgent,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        dpr: +(window.devicePixelRatio || 1).toFixed(2),
        displayHz: estimatedHz,
        cores: navigator.hardwareConcurrency || null,
        deviceMemoryGB: navigator.deviceMemory || null
      },
      results
    };
    lastReport = report;
    lastMarkdown = formatMarkdownReport(report);

    outPre.hidden = false;
    exportRow.hidden = false;
    outPre.textContent = lastMarkdown;
    liveEl.textContent = 'Done (' + results.length + ' passes)';

    // Auto-upload to scripts/serve-bench.cjs when running locally/LAN
    try {
      const res = await fetch('/__bench_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report, markdown: lastMarkdown })
      });
      if (res.ok) {
        const info = await res.json();
        if (info?.savedTo) liveEl.textContent = 'Saved: ' + info.savedTo;
      }
    } catch {}

    return report;
  }

  runSuiteBtn.onclick = () => { void executeSuite(SUITE_PASSES); };
  runChaosBtn.onclick = () => { void executeSuite(SUITE_PASSES.filter(p => p.group === 'chaos' || p.id === '01_calm_3v3')); };

  bench.runSuite = () => executeSuite(SUITE_PASSES);
  bench.getLastReport = () => lastReport;

  postProgress(`Bench HUD ready on ${navigator.userAgent}`);
  const params = new URLSearchParams(location.search);
  if (params.has('auto') && params.get('auto') !== '0') {
    setTimeout(() => { void executeSuite(SUITE_PASSES); }, 450);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
