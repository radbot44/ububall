/* Simulation-to-display body projection, seat coordinate transforms, and unified
   tick / post-goal / online playback driver shared across match and replay views. */
(function (root) {
  'use strict';

  const PRESENTATION_KEYS = new Set(['playerIndex', 'name', 'voice', '_lastHitSound', '_lastWallSound']);

  function stripPresentation(sim) {
    if (!Array.isArray(sim)) return sim;
    for (const b of sim) {
      if (!b || typeof b !== 'object') continue;
      for (const k of PRESENTATION_KEYS) delete b[k];
    }
    return sim;
  }

  function onlineOrder(items, seat) {
    return seat ? [...items.slice(3, 6), ...items.slice(0, 3), ...items.slice(6)] : items;
  }

  // Maps simulation bodies (server seat-0 order and coordinates) onto the displayed bodies.
  const viewIndex = (i, seat) => seat ? (i < 3 ? i + 3 : i < 6 ? i - 3 : 6) : i;

  function applySeatTransform(src, dst, i, seat = 0) {
    if (seat) {
      dst.x = 1000 - src.x; dst.y = 600 - src.y;
      dst.vx = -src.vx; dst.vy = -src.vy;
      dst.rotation = (src.rotation || 0) + Math.PI;
    } else {
      dst.x = src.x; dst.y = src.y;
      dst.vx = src.vx; dst.vy = src.vy;
      dst.rotation = src.rotation;
    }
    if (src.stickOffset) {
      const sign = seat ? -1 : 1;
      if (dst.stickOffset && typeof dst.stickOffset === 'object') {
        dst.stickOffset.x = sign * src.stickOffset.x;
        dst.stickOffset.y = sign * src.stickOffset.y;
      } else {
        dst.stickOffset = { x: sign * src.stickOffset.x, y: sign * src.stickOffset.y };
      }
    } else {
      delete dst.stickOffset;
    }
    dst.team = i < 3 ? 0 : i < 6 ? 1 : -1;
    if (i < 6) dst.slot = i % 3;
    else {
      delete dst.slot;
      if (src.strikerTeam !== undefined || dst.strikerTeam !== undefined) {
        dst.strikerTeam = src.strikerTeam === undefined || src.strikerTeam < 0 ? -1 : (seat ? 1 - src.strikerTeam : src.strikerTeam);
      }
    }
    return dst;
  }

  // Pure simulation-to-simulation seat transform (used when taking over a replay from seat 1).
  function transformSimSeat(sim, seat = 0) {
    return onlineOrder(structuredClone(sim), seat).map((b, i) => applySeatTransform(b, b, i, seat));
  }

  // The server's fouls as this seat sees them: teams swapped and the rink turned half round.
  function viewFouls(ububallMatch, f, seat) {
    if (!f) return ububallMatch.newFouls();
    if (!seat) return structuredClone(f);
    return {
      ...f,
      crease: [f.crease[1], f.crease[0]],
      corner: f.corner === null ? null : 3 - f.corner,
      cards: f.cards.map(i => viewIndex(i, seat))
    };
  }

  function createMatchSession(bindings = {}) {
    const state = {
      fieldView: null,
      fieldEffects: null,
      dirtyMeters: null,
      layoutDirty: true,
      renderWidth: 1,
      renderHeight: 1,
      deviceWidth: 0,
      deviceHeight: 0,
      visibleRinkHeight: 600,
      roster: [],
      draft: [],
      cpuTeam: [],
      simBodies: [],
      plans: [],
      cpu: [],
      selected: 0,
      scores: [0, 0],
      shownScores: [0, 0],
      turn: 1,
      phase: 'plan',
      elapsed: 0,
      accumulator: 0,
      drag: null,
      dragDirty: false,
      drawingDragFrame: false,
      skaters: [],
      rinkWrap: null,
      playSegments: [],
      goalReplay: null,
      postGoal: null,
      authoritativeBodies: null,
      theater: null,
      activePlayback: null,
      recording: null,
      recordingOnline: false,
      lastSaved: null,
      lastCompletedReplay: null,
      cast: null,
      shot: 'home',
      videoClock: null,
      videoAudio: null,
      cardShot: false,
      matchTicks: 0,
      online: null,
      onlineReplay: null,
      cpuClient: null,
      cpuGeneration: 0,
      stats: [],
      play: null,
      tally: null,
      scoringPlayer: null,
      roundTurns: 0,
      fouls: null,
      hitStopUntil: 0,
      foulInfo: null,
      guide: null,
      cameraMove: null
    };
    if (bindings && typeof bindings === 'object') {
      Object.defineProperties(state, Object.getOwnPropertyDescriptors(bindings));
    }
    const defineMethod = (name, fn) => {
      if (!Object.prototype.hasOwnProperty.call(state, name)) {
        Object.defineProperty(state, name, { value: fn, enumerable: false, configurable: true, writable: true });
      }
    };
    defineMethod('setShot', (next, doc = (typeof document !== 'undefined' ? document : null)) => {
      state.shot = next;
      if (doc?.body?.dataset) doc.body.dataset.shot = next;
    });
    defineMethod('bumpCpuGeneration', () => {
      state.cpuGeneration = (state.cpuGeneration || 0) + 1;
      state.cpuClient?.cancel?.();
      state.cpuClient?.dispose?.();
    });
    defineMethod('syncShownScores', sc => {
      if (Array.isArray(state.shownScores) && Array.isArray(sc)) {
        state.shownScores.splice(0, 2, ...sc);
      }
    });
    defineMethod('loadWatchReplay', ({ stats: nextStats }) => {
      state.stats = nextStats;
      state.phase = 'replay';
      state.selected = 0;
      state.drag = null;
    });
    defineMethod('endReplay', () => {
      state.phase = 'over';
      state.recording = null;
    });
    defineMethod('loadReplayTurn', ({ scores, turn, plans, guide }) => {
      state.scores = scores;
      state.turn = turn;
      state.plans = plans;
      state.guide = guide;
    });
    defineMethod('takeOverFromReplay', (
      { roster, simBodies, scores, turn, fouls, roundTurns, recording },
      { ububallMatch, syncViewBodies } = {}
    ) => {
      state.roster = roster;
      state.simBodies = simBodies;
      syncViewBodies?.(simBodies, 0);
      state.scores = scores;
      state.turn = turn;
      state.fouls = fouls;
      if (ububallMatch) {
        state.play = ububallMatch.newPlay();
        state.tally = ububallMatch.newTally();
      }
      state.roundTurns = roundTurns;
      state.matchTicks = 0;
      state.playSegments = [];
      state.selected = 0;
      state.drag = null;
      state.elapsed = 0;
      state.accumulator = 0;
      state.phase = 'plan';
      state.recording = recording;
    });
    return state;
  }

  function createBodyProjector(deps = {}) {
    const state = deps.state || deps.session || null;
    const {
      P,
      getEntries = () => state?.fieldView?.entries || null,
      getAnonymous = () => Boolean(state?.fieldView?.anonymous),
      anonymousName = i => `Ubu ${i + 1}`,
      isClassicMode = () => false,
      resolveEquippedSuper = (entry, i) => entry?.equippedSuper || P.SUPERS[i % P.SUPERS.length],
      getShownSim = () => null,
      getShownSeat = () => 0,
      getTargetBodies = () => state?.fieldView?.bodies || null,
      getDirtyMeters = () => state?.dirtyMeters || null
    } = deps;
    const PROJECTED_STATIC = new WeakMap();

    function projectBody(cb, vb, i, seat = 0, entries = getEntries(), anonymous = getAnonymous()) {
      const armed = vb.superArm;
      applySeatTransform(cb, vb, i, seat);
      vb.playerIndex = i;
      vb.omega = cb.omega;
      vb.radius = cb.radius;
      vb.mass = cb.mass;
      vb.friction = cb.friction;
      vb.grip = cb.grip;
      vb.maxSpin = cb.maxSpin;
      vb.curveMult = cb.curveMult;
      vb.curveFactor = cb.curveFactor;
      if (i < 6) {
        const entry = entries ? entries[i] : null;
        const hasModel = Boolean(entry?.model);
        const classic = hasModel && isClassicMode();
        const anonLabel = anonymous ? anonymousName(i) : null;
        const cached = hasModel ? PROJECTED_STATIC.get(vb) : null;
        const staticOk = Boolean(cached &&
          cached.index === i && cached.entry === entry && cached.model === entry.model &&
          cached.fullName === entry.model.parts?.fullName && cached.voice === entry.model.voice &&
          cached.entrySuper === entry.equippedSuper && cached.cbSuper === cb.equippedSuper &&
          cached.classic === classic && cached.anonymous === anonymous && cached.anonLabel === anonLabel &&
          'personality' in vb && 'equippedSuper' in vb);
        vb.sizeMult = cb.sizeMult;
        vb.baseRadius = cb.baseRadius;
        vb.baseMass = cb.baseMass;
        vb.baseFriction = cb.baseFriction;
        vb.baseReach = cb.baseReach;
        vb.baseStrength = cb.baseStrength;
        vb.baseStability = cb.baseStability;
        vb.baseBounciness = cb.baseBounciness;
        vb.bounciness = cb.bounciness;
        vb.impulse = cb.impulse;
        vb.power = cb.power;
        vb.reach = cb.reach;
        vb.strength = cb.strength;
        vb.stability = cb.stability;
        vb.synergyMult = cb.synergyMult ?? 1;
        vb.chemistryMult = cb.chemistryMult ?? 1;
        vb.meter = cb.meter ?? 0;
        vb.daze = cb.daze || 0;
        vb.spinStrike = cb.spinStrike || 0;
        vb.launchSpin = cb.launchSpin || 0;
        vb.ironCooldownTicks = cb.ironCooldownTicks || 0;
        vb.superTicks = cb.superTicks || 0;
        vb.superHoldTicks = cb.superHoldTicks || 0;
        vb.superBonusTicks = cb.superBonusTicks || 0;
        vb.superBonusRefund = cb.superBonusRefund || 0;
        vb.superActive = cb.superActive || null;
        vb.guarding = Boolean(cb.guarding);
        vb.ironGuard = Boolean(cb.ironGuard);
        vb.superArm = cb.superArm !== undefined ? Boolean(cb.superArm) : Boolean(armed);
        vb.stunned = Boolean(cb.stunned || cb.stunnedNext);
        if ('stunnedNext' in vb) delete vb.stunnedNext;
        vb.carded = Boolean(cb.carded);
        vb.holding = Boolean(cb.holding);
        vb.usedSuperThisTurn = Boolean(cb.usedSuperThisTurn);
        vb.superHit = Boolean(cb.superHit);
        vb.superRefunded = Boolean(cb.superRefunded);
        vb.shockwaveFired = Boolean(cb.shockwaveFired);
        if (hasModel) {
          if (!staticOk) {
            const fullName = entry.model.parts?.fullName;
            vb.name = anonymous ? anonLabel : fullName;
            vb.voice = entry.model.voice;
            vb.personality = entry.model.personality && typeof entry.model.personality === 'object' ? { ...entry.model.personality } : entry.model.personality;
            const sObj = entry.equippedSuper || (cb.equippedSuper ? { ...P.SUPERS[cb.equippedSuper.id], ...cb.equippedSuper } : resolveEquippedSuper(entry, i));
            vb.equippedSuper = classic ? null : (sObj ? { ...sObj } : null);
            PROJECTED_STATIC.set(vb, {
              index: i, entry, model: entry.model, fullName, voice: entry.model.voice,
              entrySuper: entry.equippedSuper, cbSuper: cb.equippedSuper,
              classic, anonymous, anonLabel
            });
          }
        } else {
          PROJECTED_STATIC.delete(vb);
          if (cb.personality && typeof cb.personality === 'object') vb.personality = { ...cb.personality }; else delete vb.personality;
          if (cb.equippedSuper && typeof cb.equippedSuper === 'object') vb.equippedSuper = { ...cb.equippedSuper };
          else if (cb.equippedSuper === null) vb.equippedSuper = null;
          else delete vb.equippedSuper;
          if (anonymous) vb.name = anonLabel;
        }
      } else {
        vb.onFire = Boolean(cb.onFire);
        vb.fireTicks = cb.fireTicks || 0;
        vb.pace = cb.pace || 0;
        vb.stuckTicks = cb.stuckTicks || 0;
        vb.strikerSlot = cb.strikerSlot;
        vb.strikerPower = cb.strikerPower;
        vb.strikerSynergy = cb.strikerSynergy ?? 1;
        vb.strikerTeam = cb.strikerTeam === undefined || cb.strikerTeam < 0 ? -1 : (seat ? 1 - cb.strikerTeam : cb.strikerTeam);
        vb.openingShot = Boolean(cb.openingShot);
      }
      return vb;
    }

    function viewBodies(items, seat = 0, entries = getEntries(), anonymous = getAnonymous()) {
      if (!items) return [];
      return onlineOrder(items, seat).map((cb, i) => projectBody(cb, {}, i, seat, entries, anonymous));
    }

    function toViewBody(cb, sim = getShownSim(), seat = getShownSeat(), targetBodies = getTargetBodies()) {
      if (!cb) return null;
      const idx = sim?.indexOf(cb);
      if (idx === undefined || idx < 0) return cb;
      return targetBodies?.[viewIndex(idx, seat)] || cb;
    }

    function syncViewBodies(sim = getShownSim(), seat = getShownSeat(), targetBodies = getTargetBodies(), anonymous = getAnonymous(), meters = getDirtyMeters(), entries = getEntries()) {
      if (!sim || !targetBodies) return targetBodies;
      for (let i = 0; i < sim.length; i++) {
        const vi = viewIndex(i, seat);
        const vb = targetBodies[vi] ||= {};
        projectBody(sim[i], vb, vi, seat, entries, anonymous);
        if (meters) meters.add(vb);
      }
      return targetBodies;
    }

    // Fast kinematic-only sync for intermediate 240 Hz sub-steps and mid-tick FX callbacks.
    // Preserves exact per-tick positions/velocities/fire state for trails and collision FX
    // while deferring full static trait projection and dirtyMeters updates to once per frame.
    function syncTickBodies(sim = getShownSim(), seat = getShownSeat(), targetBodies = getTargetBodies()) {
      if (!sim || !targetBodies) return targetBodies;
      for (let i = 0; i < sim.length; i++) {
        const vi = viewIndex(i, seat);
        const vb = targetBodies[vi];
        if (!vb || vb.playerIndex !== vi) {
          return syncViewBodies(sim, seat, targetBodies);
        }
        const cb = sim[i];
        applySeatTransform(cb, vb, vi, seat);
        vb.omega = cb.omega;
        vb.radius = cb.radius;
        if (vi < 6) {
          vb.reach = cb.reach;
          vb.meter = cb.meter ?? 0;
          vb.daze = cb.daze || 0;
          vb.spinStrike = cb.spinStrike || 0;
          vb.launchSpin = cb.launchSpin || 0;
          vb.ironCooldownTicks = cb.ironCooldownTicks || 0;
          vb.superTicks = cb.superTicks || 0;
          vb.superActive = cb.superActive || null;
          vb.guarding = Boolean(cb.guarding);
          vb.ironGuard = Boolean(cb.ironGuard);
          vb.stunned = Boolean(cb.stunned || cb.stunnedNext);
          vb.holding = Boolean(cb.holding);
        } else {
          vb.onFire = Boolean(cb.onFire);
          vb.fireTicks = cb.fireTicks || 0;
          vb.pace = cb.pace || 0;
          vb.stuckTicks = cb.stuckTicks || 0;
          vb.strikerSlot = cb.strikerSlot;
          vb.strikerPower = cb.strikerPower;
          vb.strikerSynergy = cb.strikerSynergy ?? 1;
          vb.openingShot = Boolean(cb.openingShot);
        }
      }
      return targetBodies;
    }

    let prevPose = null, prevPoseLen = 0, prevSeat = 0, hasPrevPose = false;

    function capturePose(sim = getShownSim(), seat = getShownSeat()) {
      if (!sim || !sim.length) { hasPrevPose = false; return; }
      const need = sim.length * 3;
      if (!prevPose || prevPose.length < need) prevPose = new Float64Array(need);
      const flip = Boolean(seat);
      for (let i = 0; i < sim.length; i++) {
        const cb = sim[i], o = i * 3;
        prevPose[o] = flip ? 1000 - cb.x : cb.x;
        prevPose[o + 1] = flip ? 600 - cb.y : cb.y;
        prevPose[o + 2] = (cb.rotation || 0) + (flip ? Math.PI : 0);
      }
      prevPoseLen = sim.length;
      prevSeat = seat;
      hasPrevPose = true;
    }

    function clearPose() {
      hasPrevPose = false;
    }

    // Blends view-body render pose (x, y, rotation) between the previous tick and current tick
    // without touching simulation state or trail sampling.
    function syncInterpolatedBodies(alpha = 1, sim = getShownSim(), seat = getShownSeat(), targetBodies = getTargetBodies()) {
      if (!sim || !targetBodies) return targetBodies;
      const t = alpha <= 0 ? 0 : (alpha >= 1 ? 1 : alpha);
      const canBlend = hasPrevPose && prevPoseLen === sim.length && prevSeat === seat && t < 1 - 1e-6;
      const flip = Boolean(seat);
      for (let i = 0; i < sim.length; i++) {
        const vi = viewIndex(i, seat), vb = targetBodies[vi];
        if (!vb) continue;
        const cb = sim[i];
        const tx = flip ? 1000 - cb.x : cb.x;
        const ty = flip ? 600 - cb.y : cb.y;
        const tr = (cb.rotation || 0) + (flip ? Math.PI : 0);
        if (canBlend) {
          const o = i * 3, px = prevPose[o], py = prevPose[o + 1], pr = prevPose[o + 2];
          const dx = tx - px, dy = ty - py;
          if (dx * dx + dy * dy <= 6400) {
            vb.x = px + dx * t;
            vb.y = py + dy * t;
            vb.rotation = pr + (tr - pr) * t;
            continue;
          }
        }
        vb.x = tx;
        vb.y = ty;
        vb.rotation = tr;
      }
      return targetBodies;
    }

    return { projectBody, viewBodies, toViewBody, syncViewBodies, syncTickBodies, capturePose, clearPose, syncInterpolatedBodies };
  }

  function createPlaybackDriver({
    P,
    ububallMatch,
    clockNow,
    impact,
    creditSave,
    popup,
    getBallView,
    traceGuide,
    recordTrails
  }) {
    function impactFor(stop, isGoal = stop >= (ububallMatch.HIT_STOP?.scoredGoal ?? 200)) {
      impact(stop, isGoal ? (ububallMatch.SCREEN_SHAKE?.goal ?? 2) : (ububallMatch.SCREEN_SHAKE?.default ?? 1));
    }

    function applyTickEvents(sim, { saves, struck, stop, applyIron = true, syncFn = null, viewFn, isGoal, onStop = null }) {
      if (syncFn && (saves.length || struck)) syncFn();
      for (const s of saves) {
        const iron = Boolean(s.iron);
        if (applyIron && iron && sim[s.index]) sim[s.index].ironGuard = true;
        creditSave(viewFn(sim[s.index], s), s.own, iron);
      }
      if (struck) {
        const ballView = getBallView();
        if (ballView) popup(ballView, 'Spin strike!');
      }
      if (!stop) return false;
      impactFor(stop, isGoal);
      if (onStop) onStop(stop);
      return true;
    }

    function stepPostGoalFrame(sim, fx, syncFn, trace = false) {
      P.stepPostGoal(sim, P.DT, fx.hit || fx.collide, fx.wall, fx.shock || fx.shockwave, fx.super);
      syncFn();
      if (trace) traceGuide(sim);
      recordTrails();
      if (!P.settled(sim.slice(0, 6))) return false;
      P.stop(sim);
      syncFn();
      return true;
    }

    function runPlaybackTicks(state, delta, speed, maxSteps, getHitStop, onStep) {
      state.steps += delta / P.DT * speed;
      for (let n = 0; state.steps >= 1 && n < maxSteps; n++) {
        const result = onStep();
        if (result === 'stop') break;
        if (result === 'reset') { state.steps = 0; break; }
        if (result === 'continue') continue;
        state.steps--;
        if (result === 'hold' || clockNow() < getHitStop()) { state.steps = 0; break; }
      }
    }

    // Shared post-goal slow-motion skater glide used identically by local and online goals.
    function advancePostGoal(postGoal, state, simDelta, fx, syncFn, maxSteps = 48, getHitStop = () => 0, onBeforeStep = null) {
      if (!postGoal || !postGoal.sim) return false;
      if (clockNow() < getHitStop()) { state.steps = 0; return true; }
      state.steps += simDelta / P.DT;
      let steps = 0;
      while (steps++ < maxSteps && state.steps >= 1) {
        state.steps -= 1;
        if (state.onTick) state.onTick();
        postGoal.ticks++;
        onBeforeStep?.();
        if (stepPostGoalFrame(postGoal.sim, fx, syncFn, true)) return false;
      }
      return true;
    }

    // Steps an online resolved turn along the authoritative server clock with per-tick view sync and trails.
    function stepOnlineTurn({
      replay,
      nowMs,
      seat,
      fouls,
      fx,
      syncSim,
      syncTick = syncSim,
      onBeforeStep = null,
      syncInterpolated = null,
      toView,
      onGoalReached,
      onSettledTurnEnd
    }) {
      if (!replay || !replay.simBodies) return { active: false, fouls };
      const elapsedSec = Math.max(0, (nowMs - replay.startedAt - (replay.paused || 0)) / 1000);
      const exactTick = elapsedSec / P.DT;
      const targetTick = Math.min(replay.ticks, Math.floor(exactTick));
      if (replay.currentTick === undefined) replay.currentTick = 0;

      const simFouls = viewFouls(ububallMatch, fouls, seat);
      if (targetTick - replay.currentTick > 60) {
        while (replay.currentTick < targetTick - 8) {
          P.step(replay.simBodies, P.DT);
          traceGuide(replay.simBodies);
          replay.currentTick++;
          ububallMatch.lapseFouls(P, replay.simBodies, simFouls);
        }
      }

      let stepped = false, tickStruck = false, stoppedByEvent = false;
      const onHit = contact => {
        if (contact?.spinStruck) tickStruck = true;
        fx.hit?.(contact);
      };
      while (replay.currentTick < targetTick) {
        tickStruck = false;
        onBeforeStep?.();
        P.step(replay.simBodies, P.DT, onHit, fx.wall, fx.shock, fx.super);
        traceGuide(replay.simBodies);
        replay.currentTick++;
        stepped = true;
        ububallMatch.lapseFouls(P, replay.simBodies, simFouls);
        const struck = tickStruck || Boolean(replay.struck?.includes(replay.currentTick));
        const now = replay.currentTick;
        const saves = (replay.saves || []).filter(s => s.tick === now);
        // Hit-stop holds the replay clock back so the rest of the turn plays on after the pause.
        const stop = replay.stops?.find(s => s.tick === now)?.ms;
        syncTick();
        const stopped = applyTickEvents(replay.simBodies, {
          saves, struck, stop, applyIron: true,
          syncFn: null,
          viewFn: b => toView(b),
          isGoal: replay.goal !== null && now >= replay.ticks,
          onStop: ms => { replay.paused = (replay.paused || 0) + ms; }
        });
        recordTrails();
        if (stopped) { stoppedByEvent = true; break; }
      }

      if (stepped || !syncInterpolated) {
        if (stepped || replay.currentTick < replay.ticks) syncSim();
      }
      if (syncInterpolated && (stepped || replay.currentTick < replay.ticks)) {
        const activeTurn = replay.currentTick < replay.ticks && !stoppedByEvent;
        const alpha = activeTurn && replay.currentTick === targetTick ? Math.max(0, Math.min(1, exactTick - targetTick)) : 1;
        syncInterpolated(alpha);
      }
      const nextFouls = !replay.fouled ? viewFouls(ububallMatch, simFouls, seat) : fouls;

      if (replay.goal !== null && replay.currentTick >= replay.ticks && !replay.goalPlayed) {
        replay.goalPlayed = true;
        onGoalReached?.();
      }
      if (replay.currentTick >= replay.ticks) {
        onSettledTurnEnd?.();
      }

      return { active: replay.currentTick < replay.ticks, fouls: nextFouls };
    }

    return {
      impactFor,
      applyTickEvents,
      stepPostGoalFrame,
      runPlaybackTicks,
      advancePostGoal,
      stepOnlineTurn
    };
  }

  const api = {
    PRESENTATION_KEYS,
    stripPresentation,
    onlineOrder,
    viewIndex,
    applySeatTransform,
    transformSimSeat,
    viewFouls,
    createMatchSession,
    createBodyProjector,
    createPlaybackDriver
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ububallPlayback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
