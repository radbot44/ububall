/* Replay Theater viewer, timeline scrubbing, 1080p60 H.264/AAC/Opus offline MP4
   video exporter, 1080x980 PNG share card renderer, and "Play from here" takeover. */
(function (root) {
  'use strict';

  const SEEK_EFFECTS = .4;
  const VIDEO = Object.freeze({
    width: 1920, height: 1080, fps: 60, bitrate: 1.5e6, keySeconds: 5, hold: 1, bug: 78,
    field: { x: 0, y: 78 - 42 * 1.92, width: 1920, height: 1152 }
  });
  const CARD = Object.freeze({
    width: 1080, height: 980, field: 146, crop: [42, 550],
    cta: 'Collect & Collide at', tagline: '3v3 turn-based hockey'
  });

  const silentAudio = new Proxy({}, { get: () => () => null });
  const ownBytes = d => d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  const winningTurn = t => Boolean(t.goal) && t.scores[t.goal.team] + 1 >= 5;

  function replayClock(ticks, dt = 1 / 240) {
    const sec = Math.floor(ticks * dt);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  function anonymousName(ububallReplay, i) {
    return `${ububallReplay.ANONYMOUS[i < 3 ? 0 : 1]} ${i % 3 + 1}`;
  }

  // Rounds are numbered by the goals before them.
  function rangeLabel(r, range, from, to) {
    const turns = from === to ? `Turn ${r.turns[from].turn}` : `Turns ${r.turns[from].turn}–${r.turns[to].turn}`;
    return range === 'round' ? `Round ${r.turns[from].scores[0] + r.turns[from].scores[1] + 1} · ${turns}` : turns;
  }

  // The game's sound calls, played into `offline` at `seconds()` on the video's timeline.
  function offlineAudio(A, offline, seconds) {
    const ctx = new Proxy(offline, {
      get: (target, key) => key === 'currentTime' ? seconds() : typeof target[key] === 'function' ? target[key].bind(target) : target[key]
    });
    // One compressor for the export's mix: a chain per sound made the render several times slower,
    // and changes loudness by well under a decibel.
    A.shareMasterChain(ctx);
    const into = (options = {}) => ({ ...options, ctx });
    return {
      getAudioContext: () => ctx,
      stop: () => A.stopMotion?.(ctx),
      stopMotion: () => A.stopMotion?.(ctx),
      playCollision: (voice, o) => A.playCollision(voice, into(o)),
      playBallHit: o => A.playBallHit(into(o)),
      playUbuMove: o => A.playUbuMove?.(into(o)),
      playSpin: o => A.playSpin?.(into(o)),
      playPuckSlide: o => A.playPuckSlide?.(into(o)),
      playCarve: o => A.playCarve?.(into(o)),
      playSlipstream: o => A.playSlipstream?.(into(o)),
      playSpinStrike: o => A.playSpinStrike?.(into(o)),
      playFireImpact: o => A.playFireImpact?.(into(o)),
      playSave: o => A.playSave?.(into(o)),
      playFirework: o => A.playFirework?.(into(o)),
      playWallHit: o => A.playWallHit(into(o)),
      playGoalHit: (type, o) => A.playGoalHit(type, into(o)),
      playSuper: (key, phase, o) => A.playSuper(key, phase, into(o)),
      playSizzle: o => A.playSizzle(into(o)),
      playFoul: (kind, o) => A.playFoul(kind, into(o)),
      playIronSave: o => A.playIronSave?.(into(o)),
      playFanfare: (voice, _customCtx, onNote, o) => A.playFanfare?.(voice, ctx, onNote || null, { ...o, loop: false })
    };
  }

  function createReplayTheater({
    $,
    window = root,
    document,
    navigator = root.navigator,
    localStorage = root.localStorage,
    getComputedStyle = root.getComputedStyle,
    MessageChannel = root.MessageChannel,
    Blob = root.Blob,
    File = root.File,
    Image = root.Image,
    URL = root.URL,
    HTMLCanvasElement = root.HTMLCanvasElement,
    HTMLImageElement = root.HTMLImageElement,
    VideoEncoder = root.VideoEncoder,
    VideoFrame = root.VideoFrame,
    AudioEncoder = root.AudioEncoder,
    AudioData = root.AudioData,
    OfflineAudioContext = root.OfflineAudioContext,
    setTimeout = root.setTimeout,
    P,
    ubu,
    ububallMatch,
    ububallReplay,
    getMp4 = () => (typeof ububallMP4 !== 'undefined' ? ububallMP4 : window?.ububallMP4),
    gameUi,
    GOAL_CALL_SECONDS = 2.4,
    materialStyles = {},
    createEffectsState,
    onlineOrder,
    viewIndex,
    stripPresentation,
    transformSimSeat,
    viewFouls,
    runPlaybackTicks,
    replayEvents,
    getReplayFx,
    replayHitStop,
    syncReplay,
    makeGuide,
    traceGuide,
    recordTrails,
    trailPositions,
    clearDiscontinuousTrails,
    emitSkaterEffects,
    updatePopups,
    updateEffects,
    clearEffects,
    celebrate,
    loopFanfare,
    stopFanfare,
    quench,
    lightNet,
    ballOnFire,
    popup,
    goalTab,
    replayFileName,
    downloadReplay,
    rinkLogo,
    getThemeColors,
    getSkaters,
    clockNow,
    gameAudio,
    classicMode,
    normalStats,
    idlePlan,
    resolveEquippedSuper,
    kickoff,
    buildTeam,
    resetPlans,
    saveRecording,
    saveActiveMatch,
    stopDemo,
    closeSummary,
    endGoalReplay,
    showMode,
    enterMatch,
    setShot,
    updateHome,
    bumpCpuGeneration,
    say,
    sync,
    draw,
    // Shared state getters & setters
    getTheater,
    setTheater,
    getActivePlayback,
    setActivePlayback,
    getFieldView,
    setFieldView,
    getFieldEffects,
    setFieldEffects,
    getVideoAudio,
    setVideoAudio,
    getVideoClock,
    setVideoClock,
    setCardShot,
    markLayoutDirty,
    setHitStopUntil,
    getShot,
    getScores,
    getTurn,
    syncShownScores,
    setFouls,
    onWatchReplayLoaded,
    onEndReplayState,
    onLoadReplayTurnState,
    onPlayFromHereState
  }) {
    const WIN_SECONDS = GOAL_CALL_SECONDS + .6;
    const currentReplay = () => getActivePlayback() || getTheater();
    const anonName = i => anonymousName(ububallReplay, i);
    const formatClock = ticks => replayClock(ticks, P.DT);
    const yieldTask = () => new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    });

    let videoLogoImage = null;
    let videoCancelled = false, exportingVideo = false, cancelVideo = null;
    let exportKind = 'video';
    let cardImage = null;

    const isExporting = () => exportingVideo || Boolean(getTheater()?.exporting);
    function cancelExport() {
      videoCancelled = true;
      cancelVideo?.();
    }

    function videoLogo() {
      if (!Image) return Promise.resolve();
      videoLogoImage ||= Object.assign(new Image(), { src: 'assets/ububall-logo-com.svg' });
      return videoLogoImage.decode?.().catch(() => {}) ?? Promise.resolve();
    }

    const videoFieldSize = () => ({
      width: Math.round(VIDEO.field.width * VIDEO.width / 1920),
      height: Math.round(VIDEO.field.height * VIDEO.width / 1920)
    });

    function replayEntry(u, i, anon = false) {
      const model = ubu && u.dna ? ubu.decode(ubu.fromCode(u.dna)) : {
        parts: { fullName: `Ubu ${i + 1}` },
        attributes: {},
        stats: typeof normalStats === 'function' ? normalStats() : {}
      };
      if (anon) model.parts = { ...model.parts, fullName: anonName(i) };
      const base = u.super === null || u.super === undefined ? null : P.SUPERS[u.super];
      const equippedSuper = base ? { ...base, ...(P.superMastery ? P.superMastery(model.supers, u.super) : {}) } : null;
      return { key: `replay-${i}`, label: 'Replay ubu', model, dna: u.dna, equippedSuper };
    }

    function createReplaySession(replay, { file = null, speed = 1, paused = false, anonymous = false, exporting = false, clock = null, audio = null, field = null } = {}) {
      const fieldView = getFieldView();
      const seat = replay.seat ?? 0, anon = Boolean(anonymous || replay.anonymous);
      const names = anon ? [...ububallReplay.ANONYMOUS] : (seat ? [...replay.names].reverse() : [...replay.names]);
      const orderedUbus = Array.isArray(replay.ubus) ? onlineOrder(replay.ubus, seat) : [];
      const liveEntries = fieldView?.entries ?? null;
      const reuseLive = Array.isArray(liveEntries) && liveEntries.length === orderedUbus.length && orderedUbus.every((u, i) => liveEntries[i]?.dna === u.dna && (liveEntries[i]?.equippedSuper?.id ?? null) === (u.super ?? null));
      const entries = reuseLive ? liveEntries.map((entry, i) => {
        const base = entry.key ? entry : { ...entry, key: `replay-${i}`, label: 'Replay ubu' };
        if (!anon) return base;
        return { ...base, model: { ...base.model, parts: { ...base.model.parts, fullName: anonName(i) } } };
      }) : orderedUbus.map((u, i) => replayEntry(u, i, anon));
      const canCanvas = exporting && document && typeof document.createElement === 'function';
      const offscreen = canCanvas ? document.createElement('canvas') : null;
      const offscreenBadges = canCanvas ? document.createElement('canvas') : null;
      return {
        replay,
        file,
        seat,
        mode: replay.mode || (fieldView?.mode ?? 'standard'),
        ...ububallReplay.timeline(replay),
        speed,
        paused,
        steps: 0,
        holdUntil: 0,
        index: 0,
        tick: 0,
        called: false,
        crowned: false,
        exporting: Boolean(exporting),
        anonymous: anon,
        names,
        entries,
        bodies: exporting ? P.kickoff() : (fieldView?.bodies ?? P.kickoff()),
        sim: null,
        fouls: ububallMatch.newFouls(),
        viewFouls: ububallMatch.newFouls(),
        scores: [0, 0],
        turn: replay.turns?.[0]?.turn ?? 1,
        plans: Array.from({ length: 3 }, () => (typeof idlePlan === 'function' ? idlePlan() : { angle: 0, power: 0, spin: 0, guard: false })),
        guide: null,
        portrait: false,
        clock,
        audio,
        field,
        canvas: offscreen,
        ctx: offscreen ? offscreen.getContext('2d') : null,
        badgeCanvas: offscreenBadges,
        badgeCtx: offscreenBadges ? offscreenBadges.getContext('2d') : null,
        fx: exporting ? createEffectsState(entries, materialStyles || {}) : null
      };
    }

    function withPlaybackContext(th, fn) {
      if (!th || getActivePlayback() === th) return fn();
      const previousPlayback = getActivePlayback(), previousView = getFieldView(), previousEffects = getFieldEffects();
      setActivePlayback(th);
      if (th.exporting) {
        setFieldView(th);
        setFieldEffects(th.fx);
      }
      try {
        return fn();
      } finally {
        setActivePlayback(previousPlayback);
        setFieldView(previousView);
        setFieldEffects(previousEffects);
      }
    }

    function updateReplayFouls(th) {
      th.viewFouls = viewFouls(th.fouls, th.seat);
      if (!th.exporting) setFouls(th.viewFouls);
    }

    function loadReplayTurn(k, fx, th = currentReplay()) {
      return withPlaybackContext(th, () => {
        const t = th.replay.turns[k];
        const replayFx = getReplayFx();
        th.index = k; th.tick = 0; th.called = th.crowned = false; th.sim = ububallReplay.restore(t.bodies);
        th.fouls = { ...ububallMatch.newFouls(), ...structuredClone(t.fouls) };
        th.scores = th.seat ? [...t.scores].reverse() : [...t.scores];
        th.turn = t.turn;
        th.guide = makeGuide(th.sim, t.plans, th.seat, th.turn, th.scores);
        // The home cards show the moves this turn was played with.
        th.plans = th.guide.moves.slice(0, 3);
        if (!th.exporting) {
          onLoadReplayTurnState?.({ scores: th.scores, turn: th.turn, plans: th.plans, guide: th.guide });
        }
        P.startTurn(th.sim, t.plans, fx ? replayFx.super : null);
        updateReplayFouls(th);
      });
    }

    function stepReplay(fx, th = currentReplay()) {
      return withPlaybackContext(th, () => {
        const sim = th.sim, replayFx = getReplayFx();
        if (fx) P.step(sim, P.DT, replayFx.hit, replayFx.wall, replayFx.shock, replayFx.super);
        else P.step(sim, P.DT);
        ububallMatch.lapseFouls(P, sim, th.fouls);
        th.tick++;
        if (fx) replayEvents(th.replay.turns[th.index], th.tick, sim);
        else { sim[6].spinStruck = false; sim[6].snapStruck = false; }
        traceGuide(sim, th.guide);
      });
    }

    function updateReplayBar() {
      const th = getTheater() || currentReplay();
      if (!th) return;
      const at = th.starts[th.index] + th.tick, seek = $('replay-seek'), play = $('replay-play');
      seek.max = th.total;
      if (!seek.matches?.(':active')) seek.value = at;
      $('replay-time').textContent = `${formatClock(at)} / ${formatClock(th.total)}`;
      play.classList.toggle('paused', th.paused);
      play.setAttribute('aria-label', th.paused ? 'Play' : 'Pause');
    }

    function replayMarks() {
      const th = getTheater(), fieldView = getFieldView(), marks = [];
      th.replay.turns.forEach((t, k) => {
        const end = th.starts[k] + t.ticks, left = `${end / th.total * 100}%`;
        if (t.goal) {
          const team = th.seat ? 1 - t.goal.team : t.goal.team;
          const scorer = t.goal.scorer === null ? null : fieldView.entries[viewIndex(t.goal.scorer, th.seat)];
          const mark = document.createElement('button');
          mark.type = 'button';
          mark.className = `replay-mark ${team ? 'away' : 'home'}`;
          mark.style.left = left;
          mark.title = [t.goal.label, scorer?.model.parts.fullName].filter(Boolean).join(' · ');
          mark.setAttribute('aria-label', mark.title);
          mark.onclick = () => seekReplay(Math.max(th.starts[k], end - 3 / P.DT));
          marks.push(mark);
        }
        if (t.cards.length) {
          const mark = document.createElement('span');
          mark.className = 'replay-mark card';
          mark.style.left = left;
          marks.push(mark);
        }
      });
      $('replay-marks').replaceChildren(...marks);
    }

    function seekReplay(at, th = currentReplay(), turnIndex = null) {
      return withPlaybackContext(th, () => {
        const turns = th.replay.turns;
        at = Math.max(0, Math.min(th.total, Math.round(at)));
        let k = turnIndex ?? 0;
        if (turnIndex === null) while (k + 1 < turns.length && th.starts[k + 1] <= at) k++;
        loadReplayTurn(k, false, th);
        const target = Math.min(at - th.starts[k], turns[k].ticks), span = Math.min(target, Math.round(SEEK_EFFECTS / P.DT));
        while (th.tick < target - span) stepReplay(false, th);
        th.holdUntil = 0; th.steps = 0;
        stopFanfare(); clearEffects(); syncReplay(th);
        // The last moment before `at` plays with its effects, silently, so the field shows its motion trails,
        // contact effects and spin as they were then.
        if (span) {
          const prevAudio = getVideoAudio(), prevClock = getVideoClock(), dt = 1 / 60;
          setVideoAudio(silentAudio);
          let curClock = clockNow() - span * P.DT * 1000;
          setVideoClock(curClock);
          try {
            while (th.tick < target) {
              for (let n = 0; n < dt / P.DT && th.tick < target; n++) { stepReplay(true, th); syncReplay(th); recordTrails(); }
              updateReplayFouls(th); emitSkaterEffects(dt);
              curClock += dt * 1000;
              setVideoClock(curClock);
              const fx = getFieldEffects();
              updatePopups(dt, fx.popups); updateEffects(dt);
            }
          } finally { setVideoAudio(prevAudio); setVideoClock(prevClock); }
        }
        // A hit-stop met on the way (or left from play, on another clock) does not hold the new moment.
        if (th.fx) th.fx.hitStopUntil = 0;
        else setHitStopUntil(0);
        updateReplayFouls(th);
        if (!th.exporting) {
          syncShownScores?.(getScores());
          sync(); updateReplayBar();
        }
        draw();
      });
    }

    // At a turn's end its goal is called and held a moment; at the replay's end it pauses. False stops this frame's steps.
    function endReplayTurn(argTh) {
      const th = argTh || currentReplay();
      if (th && getActivePlayback() !== th && (th !== getTheater() || th.exporting)) {
        return withPlaybackContext(th, () => endReplayTurn(th));
      }
      const fieldView = getFieldView(), fieldEffects = getFieldEffects();
      const t = th.replay.turns[th.index];
      if (t.goal && !th.called) {
        th.called = true; th.steps = 0; th.holdUntil = clockNow() + 2500;
        const team = th.seat ? 1 - t.goal.team : t.goal.team;
        const scorer = t.goal.scorer === null ? null : fieldView.bodies[viewIndex(t.goal.scorer, th.seat)];
        th.scores[team]++;
        if (!th.exporting) sync();
        celebrate(team, fieldView.bodies[6], t.goal.label, scorer);
        if (typeof loopFanfare === 'function' && scorer?.voice) loopFanfare(scorer.voice);
        if (typeof lightNet === 'function' && (t.goal.fireball || (typeof ballOnFire === 'function' && ballOnFire()))) lightNet(team);
        if (!th.exporting && typeof popup === 'function' && t.goal.assist !== null && t.goal.assist !== undefined) {
          const assistUbu = fieldView.bodies[viewIndex(t.goal.assist, th.seat)];
          if (assistUbu) popup(assistUbu, 'Assist');
        }
        if (!th.exporting) goalTab(team, t.goal.label, scorer?.name || null);
        return false;
      }
      // The match's winning goal: once its call clears, the winner is called before the replay goes on.
      if (winningTurn(t) && !th.crowned) {
        th.crowned = true; th.steps = 0; th.holdUntil = clockNow() + WIN_SECONDS * 1000;
        const team = th.seat ? 1 - t.goal.team : t.goal.team;
        const name = (th.names || [$('home-label').textContent, $('opponent-label').textContent])[team];
        // A comeback from 3 or more down, or a shutout, as at full time.
        const deficit = Math.max(...th.replay.turns.map(r => r.scores[1 - t.goal.team] - r.scores[t.goal.team]));
        celebrate(team, fieldView.bodies[6], name === 'You' ? 'YOU WIN!' : `${name.toUpperCase().slice(0, 16)} WINS!`);
        if (fieldEffects.goalCall) {
          fieldEffects.goalCall.name = [`${th.scores[0]}–${th.scores[1]}`, deficit >= 3 && 'Comeback from 3 down!', !th.scores[1 - team] && 'Shutout!'].filter(Boolean).join(' · ');
        }
        return false;
      }
      if (th.index + 1 >= th.replay.turns.length) {
        stopFanfare();
        if (typeof quench === 'function') quench();
        th.paused = true; th.steps = 0;
        return false;
      }
      if (t.goal) { stopFanfare(); clearEffects(); }
      const before = trailPositions();
      loadReplayTurn(th.index + 1, true, th); syncReplay(th);
      clearDiscontinuousTrails(before);
      if (!th.exporting) sync();
      return true;
    }

    function advanceReplay(delta, th = currentReplay()) {
      delta = Math.min(1 / 15, Math.max(0, delta));
      return withPlaybackContext(th, () => {
        if (!th.paused && clockNow() >= th.holdUntil && clockNow() >= replayHitStop(th)) {
          runPlaybackTicks(th, delta, th.speed, 240, () => replayHitStop(th), () => {
            if (th.tick >= th.replay.turns[th.index].ticks) return endReplayTurn(th) ? 'continue' : 'stop';
            stepReplay(true, th); syncReplay(th); recordTrails();
          });
          updateReplayFouls(th);
          emitSkaterEffects(delta * th.speed);
        }
        if (!th.exporting) updateReplayBar();
        draw();
      });
    }

    function watchReplay(replay, file) {
      saveRecording(); stopDemo(); closeSummary(); endGoalReplay(); stopFanfare(); gameAudio()?.stop?.();
      bumpCpuGeneration(); videoLogo();
      const fieldView = getFieldView();
      const seat = replay.seat, names = seat ? [...replay.names].reverse() : replay.names;
      fieldView.mode = replay.mode;
      document.body.classList.toggle('classic-match', classicMode());
      showMode(fieldView.mode);
      fieldView.entries = onlineOrder(replay.ubus, seat).map((u, i) => replayEntry(u, i, Boolean(replay.anonymous)));
      const nextStats = fieldView.entries.map(entry => classicMode() ? normalStats() : { ...entry.model.stats });
      $('home-label').textContent = names[0];
      $('opponent-label').textContent = names[1];
      $('opponent-heading').textContent = `${names[1]}'s team`;
      fieldView.bodies = kickoff(true);
      onWatchReplayLoaded?.({ stats: nextStats });
      buildTeam();
      const session = createReplaySession(replay, { file, speed: Number($('replay-speed').value), anonymous: Boolean(replay.anonymous) });
      session.bodies = fieldView.bodies;
      setTheater(session);
      say(`Replay · ${names[0]} vs ${names[1]} · ${new Date(replay.recorded).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`);
      replayMarks(); enterMatch('replay'); seekReplay(0, session);
    }

    function clearReplayViewer(toMatch = true) {
      if (!getTheater()) return false;
      setTheater(null);
      if (toMatch && getShot() === 'replay') {
        setShot('match');
      }
      stopFanfare(); gameAudio()?.stop?.(); clearEffects();
      return true;
    }

    function endReplay() {
      if (!clearReplayViewer(false)) return;
      $('home-label').textContent = 'You';
      $('opponent-label').textContent = 'CPU';
      $('opponent-heading').textContent = 'CPU team';
      onEndReplayState?.();
      updateHome?.();
    }

    function paintField(v, x, y, width, height, th = currentReplay()) {
      const fieldView = getFieldView(), skaters = getSkaters(), themeColors = getThemeColors();
      const scale = width / 1000, fieldCanvas = th?.canvas || fieldView.canvas, fieldBadges = th?.badgeCanvas || fieldView.badgeCanvas, view = th?.bodies || fieldView.bodies;
      v.drawImage(fieldCanvas, x, y, width, height);
      view.slice(0, 6).forEach((b, i) => {
        const entry = th?.entries?.[i], liveEntry = fieldView.entries?.[i];
        const sprite = (!th || !entry || liveEntry?.dna === entry.dna) ? skaters?.[i]?.firstChild : null;
        const size = 2 * b.radius * scale;
        v.save();
        v.globalAlpha = b.carded ? .3 : b.superActive === 'ghost' ? .45 : 1;
        if ((b.stunned || b.stunnedNext) && !b.carded) v.filter = 'grayscale(0.8) brightness(0.7)';
        v.translate(x + b.x * scale, y + b.y * scale); v.rotate(b.rotation);
        const readyCanvas = HTMLCanvasElement && sprite instanceof HTMLCanvasElement && sprite.width > 0;
        const readyImage = HTMLImageElement && sprite instanceof HTMLImageElement && sprite.complete && sprite.naturalWidth > 0;
        if (readyCanvas || readyImage) {
          v.drawImage(sprite, -size / 2, -size / 2, size, size);
        } else {
          v.beginPath();
          v.arc(0, 0, size / 2, 0, Math.PI * 2);
          v.fillStyle = i < 3 ? (themeColors?.home || '#00e5ff') : (themeColors?.away || '#ff4d6d');
          v.fill();
        }
        v.restore();
      });
      v.drawImage(fieldBadges, x, y, width, height);
    }

    function composeFrame(v, session) {
      const themeColors = getThemeColors();
      const f = VIDEO.field, k = VIDEO.width / 1920;
      const { names, scores: frameScores, turn: frameTurn, scorebug } = session;
      const key = `${names}|${frameScores}|${frameTurn}`;
      if (scorebug?.key !== key) {
        const { home, away, text, surface } = themeColors, cx = 960, font = scorebug?.font || getComputedStyle(document.body).fontFamily;
        const layer = scorebug?.layer || Object.assign(document.createElement('canvas'), { width: VIDEO.width, height: Math.ceil(VIDEO.bug * k) }), b = layer.getContext('2d');
        b.setTransform(k, 0, 0, k, 0, 0); b.clearRect(0, 0, 1920, VIDEO.bug);
        b.beginPath(); b.roundRect(cx - 560, 9, 1120, 60, 14); b.fillStyle = surface; b.fill();
        const logo = videoLogoImage?.naturalWidth ? videoLogoImage : rinkLogo, logoHeight = logo?.naturalWidth ? 170 * logo.naturalHeight / logo.naturalWidth : 0;
        if (logoHeight) b.drawImage(logo, cx - 548, 39 - logoHeight / 2, 170, logoHeight);
        b.textBaseline = 'middle';
        for (const team of [0, 1]) {
          const left = team ? cx : cx - 360;
          b.fillStyle = team ? away : home; b.fillRect(left, 9, 360, 60);
          b.fillStyle = team ? '#ffffff' : '#1b1e26';
          b.font = `800 25px ${font}`; b.textAlign = team ? 'right' : 'left';
          b.fillText(names[team].toUpperCase().slice(0, 16), team ? left + 344 : left + 16, 40);
          b.font = `800 38px ${font}`; b.textAlign = 'center';
          b.fillText(String(frameScores[team]), team ? left + 40 : left + 320, 40);
        }
        b.fillStyle = text; b.textAlign = 'center'; b.font = `800 23px ${font}`;
        b.fillText(`T${frameTurn}  REPLAY`, cx + 460, 40);
        session.scorebug = { key, font, layer };
      }
      v.setTransform(1, 0, 0, 1, 0, 0);
      v.fillStyle = themeColors.background; v.fillRect(0, 0, VIDEO.width, VIDEO.height);
      v.setTransform(k, 0, 0, k, 0, 0);
      paintField(v, f.x, f.y, f.width, f.height, session);
      v.setTransform(1, 0, 0, 1, 0, 0);
      v.drawImage(session.scorebug.layer, 0, 0);
    }

    async function encodeAudio(buffer, length) {
      if (!buffer || !AudioEncoder) return null;
      const mp4 = getMp4();
      const rate = buffer.sampleRate;
      for (const [codec, bitrate, frame] of [['mp4a.40.2', 160000, 1024], ['opus', 128000, 960]]) {
        const config = { codec, bitrate, sampleRate: rate, numberOfChannels: 2 };
        if (!(await AudioEncoder.isConfigSupported(config).catch(() => ({}))).supported) continue;
        const samples = [];
        let description = null, failure = null;
        const encoder = new AudioEncoder({
          error: error => { failure = error; },
          output: (chunk, meta) => {
            if (meta?.decoderConfig?.description) description = ownBytes(meta.decoderConfig.description);
            const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
            samples.push({ data, duration: chunk.duration ? Math.round(chunk.duration * rate / 1e6) : frame });
          }
        });
        encoder.configure(config);
        const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
        for (let at = 0; at < length; at += 4800) {
          const n = Math.min(4800, length - at), data = new Float32Array(n * 2);
          data.set(left.subarray(at, at + n)); data.set(right.subarray(at, at + n), n);
          const audio = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(at * 1e6 / rate), data });
          encoder.encode(audio); audio.close();
        }
        await encoder.flush(); encoder.close();
        if (failure) throw failure;
        const opus = codec === 'opus';
        return {
          codec: opus ? 'opus' : 'mp4a', channels: 2, sampleRate: rate, timescale: rate, bitrate, samples,
          description: opus ? null : description || Uint8Array.of(0x11, 0x90),
          preSkip: opus ? mp4.opusPreSkip(description) : undefined
        };
      }
      return null;
    }

    async function exportVideo(slice) {
      const dialog = $('export-dialog'), status = $('export-status'), progress = $('export-progress'), close = $('export-close');
      videoCancelled = false; exportingVideo = true; progress.value = 0; progress.hidden = false; status.textContent = 'Preparing…';
      let session = null, out = null, encoder = null, blob = null, stopAudio = null;
      try {
        if (!getMp4() && window?.loadMp4Script) await window.loadMp4Script();
        const mp4 = getMp4();
        let config = null;
        search: for (const codec of ['avc1.64002A', 'avc1.4D402A', 'avc1.42E02A']) {
          for (const bitrateMode of ['constant', 'variable']) {
            if (videoCancelled) break search;
            const option = { codec, width: VIDEO.width, height: VIDEO.height, bitrate: VIDEO.bitrate, bitrateMode, framerate: VIDEO.fps, avc: { format: 'avc' } };
            if ((await VideoEncoder.isConfigSupported(option).catch(() => ({}))).supported) { config = option; break search; }
          }
        }
        if (!videoCancelled && !config) { status.textContent = 'This browser cannot encode MP4 video.'; progress.hidden = true; close.textContent = 'Close'; return; }
        const skaters = getSkaters() || [];
        if (!videoCancelled) await Promise.all([videoLogo(), ...skaters.map(node => node?.firstChild?.decode?.().catch(() => {}))]);
        if (!videoCancelled) {
          session = createReplaySession(slice.replay, {
            file: slice.file,
            speed: 1,
            paused: false,
            anonymous: Boolean(slice.hidden || slice.replay.anonymous),
            exporting: true,
            clock: 0,
            field: videoFieldSize()
          });
          const holdFrames = Math.ceil(VIDEO.hold * VIDEO.fps), rate = 48000;
          const frameBudget = 1 + holdFrames + session.replay.turns.reduce((frames, t) => frames +
            Math.ceil(t.ticks * P.DT * VIDEO.fps) + 1 +
            t.stops.reduce((extra, stop) => extra + Math.ceil(stop.ms * VIDEO.fps / 1000) + 1, 0) +
            (t.goal ? Math.ceil(2.5 * VIDEO.fps) + 1 : 0) +
            (winningTurn(t) ? Math.ceil(WIN_SECONDS * VIDEO.fps) + 1 : 0), 0);
          const maxFrames = 5 * 60 * VIDEO.fps;
          if (frameBudget > maxFrames) {
            status.textContent = 'This replay is too long to export as an MP4 (5 minutes maximum). Export a single round or turn instead.';
            progress.hidden = true; close.textContent = 'Close'; return;
          }
          const offline = new OfflineAudioContext(2, Math.ceil(frameBudget / VIDEO.fps * rate), rate);
          out = document.createElement('canvas'); out.width = VIDEO.width; out.height = VIDEO.height;
          const v = out.getContext('2d'), samples = [];
          let description = null, failure = null, wakeQueue = null;
          const wake = () => { if (wakeQueue) { const fn = wakeQueue; wakeQueue = null; fn(); } };
          cancelVideo = wake;
          encoder = new VideoEncoder({
            error: error => { failure = error; wake(); },
            output: (chunk, meta) => {
              if (meta?.decoderConfig?.description) description = ownBytes(meta.decoderConfig.description);
              const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
              samples.push({ data, duration: 90000 / VIDEO.fps, key: chunk.type === 'key' });
            }
          });
          encoder.addEventListener('dequeue', wake);
          encoder.configure(config);
          session.audio = offlineAudio(window.ubuAudio, offline, () => session.clock / 1000);
          let waiting = null, videoDone = false;
          const pump = () => {
            if (waiting !== null && (videoDone || session.clock / 1000 >= waiting + 1)) {
              waiting = null;
              try { offline.resume()?.catch?.(() => {}); } catch {}
            }
          };
          stopAudio = () => {
            if (session) session.audio = null;
            videoDone = true;
            pump();
          };
          for (let mark = 1; mark < offline.length / rate; mark++) offline.suspend(mark).then(() => { waiting = mark; pump(); }, () => {});
          const rendering = offline.startRendering();
          rendering?.catch?.(() => {});
          gameAudio()?.stop?.();
          seekReplay(0, session);
          let frames = 0, endFrame = Infinity;
          for (; frames < endFrame && !videoCancelled && !failure; frames++) {
            const f = frames;
            if (f) {
              session.clock = f * 1000 / VIDEO.fps;
              updatePopups(1 / VIDEO.fps, session.fx.popups);
              withPlaybackContext(session, () => {
                updateEffects(1 / VIDEO.fps, session.fx);
                advanceReplay(1 / VIDEO.fps, session);
              });
            }
            composeFrame(v, session);
            if (session.paused && endFrame === Infinity) endFrame = f + holdFrames;
            const frame = new VideoFrame(out, { timestamp: Math.round(f * 1e6 / VIDEO.fps), duration: Math.round(1e6 / VIDEO.fps) });
            encoder.encode(frame, { keyFrame: f % (VIDEO.keySeconds * VIDEO.fps) === 0 }); frame.close();
            pump();
            while (encoder.encodeQueueSize > 4 && !videoCancelled && !failure) {
              await new Promise(resolve => {
                wakeQueue = resolve;
                setTimeout(wake, 3000);
              });
            }
            if (f % 15 === 0) {
              progress.value = .9 * f / Math.min(endFrame, frameBudget);
              status.textContent = `Rendering ${formatClock(f / VIDEO.fps / P.DT)}…`;
              await yieldTask();
            }
          }
          if (!videoCancelled && !failure) await encoder.flush();
          if (failure) throw failure;
          if (!videoCancelled) {
            stopAudio();
            status.textContent = 'Mixing sound…';
            const audio = await encodeAudio(await rendering, Math.round(frames / VIDEO.fps * rate));
            if (!videoCancelled) {
              blob = new Blob(mp4.write({ width: VIDEO.width, height: VIDEO.height, timescale: 90000, description, samples }, audio), { type: 'video/mp4' });
              if (!audio) status.textContent = 'This browser cannot encode sound, so the video is silent.';
            }
          }
        }
      } catch (error) {
        status.textContent = `The video could not be made: ${error.message}`;
      } finally {
        cancelVideo = null;
        stopFanfare();
        stopAudio?.();
        if (encoder && encoder.state !== 'closed') encoder.close();
        if (session?.fx?.sizzle) { session.fx.sizzle.stop?.(); session.fx.sizzle = null; }
        if (out) { out.width = 0; out.height = 0; }
        if (session?.canvas) { session.canvas.width = 0; session.canvas.height = 0; }
        if (session?.badgeCanvas) { session.badgeCanvas.width = 0; session.badgeCanvas.height = 0; }
        if (session?.scorebug?.layer) { session.scorebug.layer.width = 0; session.scorebug.layer.height = 0; }
        exportingVideo = false;
      }
      close.textContent = 'Close';
      if (videoCancelled) { dialog.close(); return; }
      if (!blob) return;
      progress.value = 1;
      const name = replayFileName(slice.replay.recorded, slice.replay.title) + '.mp4';
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
      link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 60000);
      status.textContent = `${status.textContent.startsWith('This browser') ? status.textContent + ' ' : ''}Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB).`;
    }

    function exportRange(range) {
      const th = getTheater(), last = th.replay.turns.length - 1;
      return range === 'match' ? [0, last] : range === 'round' ? ububallReplay.roundRange(th.replay, th.index) : [th.index, th.index];
    }

    function exportSlice(range, hidden) {
      const th = getTheater(), r = th.replay, [from, to] = exportRange(range), whole = from === 0 && to === r.turns.length - 1;
      hidden &&= !r.anonymous;
      const names = hidden ? ububallReplay.ANONYMOUS : th.seat ? [...r.names].reverse() : r.names;
      const title = whole ? (hidden ? null : r.title) : `${rangeLabel(r, range, from, to)} · ${names[0]} vs ${names[1]}`.slice(0, ububallReplay.MAX_TITLE).trim();
      const replay = whole ? r : ububallReplay.clip(r, from, to, title);
      return { replay: hidden ? ububallReplay.anonymize(replay, title) : replay, file: whole && !hidden ? th.file : null, hidden };
    }

    function openExport(kind) {
      const th = getTheater();
      if (!th || isExporting()) return;
      if (kind === 'video' && window?.loadMp4Script) void window.loadMp4Script();
      exportKind = kind;
      $('export-title').textContent = kind === 'video' ? 'Export video' : 'Export replay';
      $('export-note').textContent = kind === 'video' ? 'Saves an MP4 video with sound.' : 'Saves a .ububall file to watch in ububall.';
      for (const button of $('export-options').querySelectorAll('button')) {
        const [from, to] = exportRange(button.dataset.range);
        button.querySelector('small').textContent = `${rangeLabel(th.replay, button.dataset.range, from, to)} · ${formatClock(th.replay.turns.slice(from, to + 1).reduce((n, t) => n + t.ticks, 0))}`;
      }
      $('export-private').closest('label').hidden = th.replay.anonymous;
      try { $('export-private').checked = localStorage.getItem('ububall-export-private') === 'on'; } catch {}
      $('export-options').hidden = false; $('export-progress').hidden = true; $('export-status').textContent = ''; $('export-close').textContent = 'Cancel';
      $('export-dialog').showModal();
    }

    function drawShareCard(hidden) {
      const th = getTheater();
      if (!th) return;
      const fieldView = getFieldView(), themeColors = getThemeColors();
      const out = $('share-card'), g = out.getContext('2d'), { home, away, text, surface, background } = themeColors;
      const anon = Boolean(hidden || th.replay.anonymous), portrait = fieldView.portrait, prevAnon = fieldView.anonymous;
      const names = anon ? ububallReplay.ANONYMOUS : (th.names || [$('home-label').textContent, $('opponent-label').textContent]);
      const cardScores = th.scores || getScores(), cardTurn = th.turn ?? getTurn();
      const font = getComputedStyle(document.body).fontFamily;
      const k = CARD.width / 1000, [cropTop, cropBottom] = CARD.crop, fieldBottom = CARD.field + (cropBottom - cropTop) * k;
      g.fillStyle = background; g.fillRect(0, 0, CARD.width, CARD.height);
      try {
        fieldView.portrait = false; setCardShot(true); fieldView.anonymous = anon; fieldView.field = { width: CARD.width, height: 600 * k }; draw();
        g.save(); g.beginPath(); g.rect(0, CARD.field, CARD.width, fieldBottom - CARD.field); g.clip();
        paintField(g, 0, CARD.field - cropTop * k, CARD.width, 600 * k, th);
        g.restore();
      } finally {
        fieldView.field = null; setCardShot(false); fieldView.anonymous = prevAnon; fieldView.portrait = portrait; markLayoutDirty(); draw();
      }
      const bugLeft = 160 * k, bugWidth = 680 * k, middle = 110, side = (bugWidth - middle) / 2;
      g.textBaseline = 'middle';
      g.save(); g.beginPath(); g.roundRect(bugLeft, 36, bugWidth, 90, 18); g.clip();
      for (const team of [0, 1]) {
        const left = team ? bugLeft + side + middle : bugLeft;
        g.fillStyle = team ? away : home; g.fillRect(left, 36, side, 90);
        g.fillStyle = team ? '#ffffff' : '#1b1e26';
        g.font = `800 52px ${font}`; g.textAlign = 'center';
        g.fillText(String(cardScores[team]), team ? left + 42 : left + side - 42, 83);
        const name = names[team].toUpperCase().slice(0, 16), room = side - 100;
        let size = 28;
        do g.font = `800 ${size}px ${font}`; while (g.measureText(name).width > room && --size > 14);
        g.textAlign = team ? 'right' : 'left';
        g.fillText(name, team ? left + side - 18 : left + 18, 82, room);
      }
      g.fillStyle = surface; g.fillRect(bugLeft + side, 36, middle, 90);
      g.fillStyle = text; g.textAlign = 'center'; g.font = `800 28px ${font}`; g.fillText(`T${cardTurn}`, CARD.width / 2, 82);
      g.restore();
      g.textBaseline = 'alphabetic'; g.textAlign = 'center'; g.fillStyle = text; g.font = `400 34px 'Uburoom Sans', ${font}`;
      g.fillText(CARD.cta, CARD.width / 2, fieldBottom + 60);
      const logo = videoLogoImage, logoWidth = 500, logoHeight = logo?.naturalWidth ? logoWidth * logo.naturalHeight / logo.naturalWidth : 0;
      if (logoHeight) g.drawImage(logo, (CARD.width - logoWidth) / 2, fieldBottom + 80, logoWidth, logoHeight);
      g.font = `400 40px 'Uburoom Sans', ${font}`; g.fillStyle = text;
      g.fillText(CARD.tagline, CARD.width / 2, fieldBottom + 100 + logoHeight + 30);
      const name = `${replayFileName(th.replay.recorded, hidden ? null : th.replay.title)}-turn-${cardTurn}.png`;
      cardImage = new Promise((resolve, reject) => out.toBlob(blob => {
        if (blob) resolve(new File([blob], name, { type: 'image/png' }));
        else reject(new Error('Could not create share card image.'));
      }, 'image/png'));
    }

    async function openShare() {
      const th = getTheater();
      if (!th || isExporting()) return;
      const skaters = getSkaters() || [];
      await Promise.all([
        videoLogo(),
        document.fonts?.load?.(`40px 'Uburoom Sans'`)?.catch(() => {}),
        ...skaters.map(node => node?.firstChild?.decode?.().catch(() => {}))
      ]);
      if (getTheater() !== th || isExporting()) return;
      $('share-private').closest('label').hidden = th.replay.anonymous;
      try { $('share-private').checked = localStorage.getItem('ububall-export-private') === 'on'; } catch {}
      drawShareCard($('share-private').checked);
      $('share-dialog').showModal();
    }

    // Play from here: a match against the CPU from the start of the turn on screen, playing the left team.
    function playFromHere() {
      const th = getTheater();
      if (!th || isExporting()) return;
      const fieldView = getFieldView();
      const t = th.replay.turns[th.index], [roundStart] = ububallReplay.roundRange(th.replay, th.index), entries = fieldView.entries;
      const field = stripPresentation(transformSimSeat(ububallReplay.restore(t.bodies), th.seat));
      field.forEach((b, i) => {
        delete b.meterTick;
        if (i < 6) {
          b.personality = entries[i]?.model?.personality;
          const rawSuper = entries[i]?.equippedSuper;
          const sObj = classicMode() ? null : (rawSuper
            ? (rawSuper.bonusTicks !== undefined ? rawSuper : { ...rawSuper, ...(P.superMastery ? P.superMastery(entries[i]?.model?.supers, rawSuper.id) : {}) })
            : resolveEquippedSuper(entries[i], i));
          b.equippedSuper = sObj ? { id: sObj.id, key: sObj.key, bonusTicks: sObj.bonusTicks || 0, bonusRefund: sObj.bonusRefund || 0 } : null;
          b.superBonusTicks = sObj?.bonusTicks || 0;
          b.superBonusRefund = sObj?.bonusRefund || 0;
        }
      });
      stopFanfare(); gameAudio()?.stop?.();
      setTheater(null); clearEffects(); enterMatch('match');
      $('home-label').textContent = 'You';
      $('opponent-label').textContent = 'CPU';
      $('opponent-heading').textContent = 'CPU team';
      const nextRoster = entries.slice(0, 3).map((e, i) => e.key ? e : { ...e, key: `replay-${i}`, label: e.label || 'Replay ubu' });
      const nextScores = th.seat ? [...t.scores].reverse() : [...t.scores];
      const nextFouls = viewFouls({ ...ububallMatch.newFouls(), ...structuredClone(t.fouls) }, th.seat);
      const nextRecording = ububallReplay.create({
        mode: fieldView.mode,
        names: ['You', 'CPU'],
        ubus: field.slice(0, 6).map((b, i) => ({ dna: entries[i].dna, super: b.equippedSuper?.id ?? null }))
      });
      onPlayFromHereState?.({
        roster: nextRoster,
        simBodies: field,
        scores: nextScores,
        turn: t.turn,
        fouls: nextFouls,
        roundTurns: th.index - roundStart,
        recording: nextRecording
      });
      buildTeam(); resetPlans(); saveActiveMatch?.(); say('Playing from the replay. Plan your launches.'); draw();
    }

    function bindEvents() {
      $('replay-seek').oninput = event => { if (getTheater()) seekReplay(Number(event.target.value)); };
      $('replay-play').onclick = () => {
        const th = getTheater();
        if (!th) return;
        if (th.paused && th.index === th.replay.turns.length - 1 && th.tick >= th.replay.turns[th.index].ticks) seekReplay(0);
        th.paused = !th.paused; th.steps = 0;
        if (th.paused) { stopFanfare(); if (typeof quench === 'function') quench(); }
        updateReplayBar();
      };
      $('replay-prev').onclick = () => {
        const th = getTheater();
        if (th) seekReplay(th.starts[Math.max(0, th.tick > 120 ? th.index : th.index - 1)]);
      };
      $('replay-next').onclick = () => {
        const th = getTheater();
        if (th && th.index + 1 < th.replay.turns.length) seekReplay(th.starts[th.index + 1]);
      };
      gameUi?.select?.($('replay-speed'));
      $('replay-speed').onchange = event => { if (getTheater()) getTheater().speed = Number(event.target.value); };

      $('export-private').onchange = event => {
        try { localStorage.setItem('ububall-export-private', event.target.checked ? 'on' : 'off'); } catch {}
      };
      $('export-options').onclick = async event => {
        const range = event.target.closest('button')?.dataset.range;
        if (!range || !getTheater()) return;
        $('export-options').hidden = true;
        const slice = exportSlice(range, $('export-private').checked);
        if (exportKind === 'video') { await exportVideo(slice); return; }
        try {
          downloadReplay(slice.file || await ububallReplay.write(slice.replay), slice.replay.recorded, slice.replay.title);
          $('export-status').textContent = `Saved ${replayFileName(slice.replay.recorded, slice.replay.title)}.ububall.`;
        } catch (error) { $('export-status').textContent = error.message; }
        $('export-close').textContent = 'Close';
      };
      $('replay-export-video').hidden = !(VideoEncoder && OfflineAudioContext);
      $('replay-export-video').onclick = () => openExport('video');
      $('replay-export-file').onclick = () => openExport('replay');

      const canShareFiles = Boolean(navigator?.canShare && File && navigator.canShare({ files: [new File([], 'card.png', { type: 'image/png' })] }));
      $('share-send').hidden = !canShareFiles;
      $('share-save').classList?.toggle?.('primary', !canShareFiles);
      $('replay-card').onclick = openShare;
      $('share-private').onchange = event => {
        try { localStorage.setItem('ububall-export-private', event.target.checked ? 'on' : 'off'); } catch {}
        drawShareCard(event.target.checked);
      };
      $('share-send').onclick = async () => {
        try { await navigator.share({ files: [await cardImage], text: 'A moment from ububall. Play at https://ububall.com' }); } catch {}
      };
      $('share-save').onclick = async () => {
        try {
          const file = await cardImage;
          const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
          link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 60000);
        } catch {}
      };
      $('share-close').onclick = () => $('share-dialog').close();
      $('export-close').onclick = () => { if (isExporting()) cancelExport(); else $('export-dialog').close(); };
      $('export-dialog').addEventListener?.('cancel', event => { if (isExporting()) { event.preventDefault(); cancelExport(); } });
      $('replay-take-over').onclick = playFromHere;
    }

    return {
      anonymousName: anonName,
      replayClock: formatClock,
      videoLogo,
      isExporting,
      cancelExport,
      replayEntry,
      createReplaySession,
      withPlaybackContext,
      updateReplayFouls,
      loadReplayTurn,
      stepReplay,
      seekReplay,
      endReplayTurn,
      advanceReplay,
      updateReplayBar,
      replayMarks,
      watchReplay,
      clearReplayViewer,
      endReplay,
      composeFrame,
      paintField,
      encodeAudio,
      exportRange,
      exportSlice,
      openExport,
      exportVideo,
      drawShareCard,
      openShare,
      playFromHere,
      bindEvents
    };
  }

  const api = {
    SEEK_EFFECTS,
    VIDEO,
    CARD,
    replayClock,
    anonymousName,
    rangeLabel,
    winningTurn,
    offlineAudio,
    createReplayTheater
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ububallTheater = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
