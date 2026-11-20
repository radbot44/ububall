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

  function defineSessionMethod(state, name, fn, { overwrite = false } = {}) {
    if (overwrite || !Object.prototype.hasOwnProperty.call(state, name)) {
      Object.defineProperty(state, name, { value: fn, enumerable: false, configurable: true, writable: true });
    }
  }

  function attachSessionMethods(state) {
    defineSessionMethod(state, '__isMatchSession', true, { overwrite: true });
    defineSessionMethod(state, 'setShot', (next, doc = (typeof document !== 'undefined' ? document : null)) => {
      state.shot = next;
      if (doc?.body?.dataset) doc.body.dataset.shot = next;
    });
    defineSessionMethod(state, 'bumpCpuGeneration', () => {
      state.cpuGeneration = (state.cpuGeneration || 0) + 1;
      state.cpuClient?.cancel?.();
      state.cpuClient?.dispose?.();
    });
    defineSessionMethod(state, 'syncShownScores', sc => {
      if (Array.isArray(state.shownScores) && Array.isArray(sc)) {
        state.shownScores.splice(0, 2, ...sc);
      }
    });
    defineSessionMethod(state, 'loadWatchReplay', ({ stats: nextStats }) => {
      state.stats = nextStats;
      state.phase = 'replay';
      state.selected = 0;
      state.drag = null;
    });
    defineSessionMethod(state, 'endReplay', () => {
      state.phase = 'over';
      state.recording = null;
    });
    defineSessionMethod(state, 'loadReplayTurn', ({ scores, turn, plans, guide }) => {
      state.scores = scores;
      state.turn = turn;
      state.plans = plans;
      state.guide = guide;
    });
    defineSessionMethod(state, 'takeOverFromReplay', (
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
    defineSessionMethod(state, 'currentReplay', () => state.activePlayback || state.theater || null);
    defineSessionMethod(state, 'activeOnlineSim', () => {
      const pg = state.postGoal || null;
      const onl = state.online || null;
      const onlRep = state.onlineReplay || null;
      if (pg?.sim) return pg.sim;
      if (onlRep) {
        if ((onlRep.currentTick ?? 0) < onlRep.ticks) return onlRep.simBodies;
        if (onlRep.postGoalSim) return onlRep.postGoalSim;
      }
      return onl?.state?.game?.bodies ?? onlRep?.simBodies;
    });
    defineSessionMethod(state, 'shownSim', () => {
      const rep = state.goalReplay || state.currentReplay();
      if (rep) return rep.sim;
      const onl = state.online || null;
      if (onl?.active) return state.activeOnlineSim();
      return state.postGoal?.sim ?? state.simBodies;
    });
    defineSessionMethod(state, 'shownSeat', () => {
      const rep = state.goalReplay || state.currentReplay();
      if (rep) return rep.seat;
      const onl = state.online || null;
      if (onl?.active) return state.postGoal?.seat ?? onl.state?.seat ?? 0;
      return 0;
    });
    return state;
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
      lastTime: 0,
      drag: null,
      dragDirty: false,
      drawingDragFrame: false,
      skaters: [],
      rinkWrap: null,
      playSegments: [],
      goalReplay: null,
      goalReplayAt: 0,
      goalReplayDelayMs: 0,
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
      returnShot: 'home',
      returnPortrait: false,
      handoffToMatch: false,
      videoClock: null,
      videoAudio: null,
      cardShot: false,
      matchTicks: 0,
      online: null,
      onlineReplay: null,
      onlineRoster: '',
      onlineTurn: 0,
      onlineDisconnected: false,
      onlinePhase: '',
      onlinePlanFouls: null,
      cpuClient: null,
      cpuGeneration: 0,
      cpuLevel: 'medium',
      cpuMode: 'standard',
      cpuDone: false,
      cpuReady: Promise.resolve(),
      cpuMatchSeed: 0,
      demo: false,
      demoLevels: ['medium', 'hard'],
      demoRun: 0,
      demoGame: 0,
      DEMO_STOP: null,
      inDiscord: false,
      planDeadline: 0,
      planPausedAt: null,
      firstTurnStep: null,
      firstTurnStarted: null,
      firstTurnSeen: false,
      spinSlider: false,
      fieldBox: null,
      pullBehind: false,
      arrowGrab: null,
      dragStart: null,
      dragStartClient: null,
      dragMoved: false,
      dragMode: null,
      tapGuards: false,
      setupFor: 'cpu',
      lineupMove: null,
      stats: [],
      play: null,
      tally: null,
      scoringPlayer: null,
      roundTurns: 0,
      fouls: null,
      hitStopUntil: 0,
      foulInfo: null,
      foulInfoKey: '',
      foulBox: null,
      guide: null,
      cameraMove: null,
      cameraDone: Promise.resolve(),
      resolveCameraDone: null,
      cameraStepRaf: 0,
      pendingExitCollection: null,
      afterCollectionShrink: null,
      fullscreenRequest: null,
      lobbyGeneration: 0,
      lobbyView: null,
      savedTeams: null,
      teamIndex: -1,
      rosterSlot: 0,
      lastCpuSetup: null,
      rulesGameNumber: 0,
      videoCancelled: false,
      knobs: [],
      collectionShownLength: 1000,
      collectionTargetLength: 1000,
      collectionLengthRaf: 0,
      collectionRotateHold: false,
      collectionLengthOverride: null,
      collectionShrinkingBox: null,
      collectionLayout: null,
      collectionScrollRaf: 0,
      collectionPortrait: null,
      bugMode: 'standard'
    };
    if (bindings && typeof bindings === 'object') {
      Object.defineProperties(state, Object.getOwnPropertyDescriptors(bindings));
    }
    return attachSessionMethods(state);
  }

  function wrapSessionState(raw) {
    if (raw?.__isMatchSession) return raw;
    if (!raw || typeof raw !== 'object') return createMatchSession();
    const defineAliasProxy = (prop, aliases = {}) => {
      if (Object.prototype.hasOwnProperty.call(raw, prop)) return;
      const proxy = new Proxy({}, {
        get: (_, key) => raw[aliases[key] ?? key],
        set: (_, key, value) => { raw[aliases[key] ?? key] = value; return true; },
        has: (_, key) => (aliases[key] ?? key) in raw
      });
      Object.defineProperty(raw, prop, { value: proxy, enumerable: false, configurable: true, writable: true });
    };
    defineAliasProxy('fieldView', {
      mode: 'matchMode',
      entries: 'teamEntries',
      anonymous: 'anonymousNames',
      portrait: 'isPortrait',
      field: 'videoField'
    });
    defineAliasProxy('fieldEffects', {});
    return attachSessionMethods(raw);
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

  function presFallback() {
    if (root.ububallPresentation) return root.ububallPresentation;
    if (typeof require === 'function') {
      try { return require('./ububall-presentation.js'); } catch { return null; }
    }
    return null;
  }

  function statsFallback() {
    if (root.ububallStats) return root.ububallStats;
    if (typeof require === 'function') {
      try { return require('./ububall-stats.js'); } catch { return null; }
    }
    return null;
  }

  function makeLookup(deps = {}) {
    const state = wrapSessionState(deps.state ?? deps.session ?? deps);
    const act = deps.actions || null;
    const fn = name => deps[name] ?? act?.[name] ?? state[name];
    const $ = id => fn('$')?.(id);
    const getDoc = () => deps.document ?? state.document ?? root.document ?? (typeof document !== 'undefined' ? document : null);
    const getWin = () => deps.window ?? state.window ?? root.window ?? root;
    const getPerf = () => deps.performance ?? state.performance ?? root.performance ?? (typeof performance !== 'undefined' ? performance : null);
    const getRaf = () => (deps.requestAnimationFrame !== undefined ? deps.requestAnimationFrame : (act?.requestAnimationFrame !== undefined ? act.requestAnimationFrame : state.requestAnimationFrame)) ?? root.requestAnimationFrame;
    const getSetTimeout = () => fn('setTimeout') ?? (typeof setTimeout === 'function' ? setTimeout : null);
    const getClearTimeout = () => fn('clearTimeout') ?? (typeof clearTimeout === 'function' ? clearTimeout : null);
    return { state, act, fn, $, getDoc, getWin, getPerf, getRaf, getSetTimeout, getClearTimeout };
  }

  function resolveEquippedSuper(P, entry, slotIndex = 0) {
    if (!entry) return P.SUPERS[0];
    const id = entry.equippedSuper?.id ?? ((entry.model?.supers?.[0] ?? slotIndex) % 8);
    const mastery = P.superMastery(entry.model?.supers, id);
    return { ...P.SUPERS[id], ...mastery };
  }

  function restoreEntry(P, ubu, saved, resolveSuper = (entry, i) => resolveEquippedSuper(P, entry, i)) {
    if (!saved || !saved.dna) return null;
    const hasSuper = saved.equippedSuper?.id != null;
    const rawDNA = ubu.fromCode(saved.dna);
    const model = ubu.decode(rawDNA);
    return {
      key: saved.key || ('custom-' + saved.dna.slice(0, 8)),
      dna: saved.dna,
      label: saved.label || model.parts.fullName,
      model,
      equippedSuper: hasSuper ? resolveSuper({ model, equippedSuper: saved.equippedSuper }) : null
    };
  }

  function formatDrawerSuperStatus(body) {
    const meterVal = Math.max(0, Math.min(100, body?.meter || 0));
    const meterPct = Math.floor(meterVal);
    if (body?.superArm) return `Armed · ${meterPct}%`;
    if (body?.carded) return `${meterPct}% · Carded`;
    if (body?.stunned) return `${meterPct}% · Stunned`;
    if (meterVal >= 100) return '100% · Ready';
    return `${meterPct}%`;
  }

  function createMeterController(deps = {}) {
    const { state, fn, $ } = makeLookup(deps);
    const getP = () => deps.P ?? state.P;
    const getMatch = () => deps.ububallMatch ?? state.ububallMatch;

    function creditSave(body, own, iron = false) {
      const P = getP(), ububallMatch = getMatch();
      if (iron && body) body.ironGuard = true;
      fn('popup')?.(body, iron ? (own ? 'Trap!' : 'Big save!') : own ? 'Save...' : 'Save!');
      if (iron) {
        fn('steamRing')?.(body.x, body.y, body.radius);
        fn('gameAudio')?.()?.playIronSave?.();
      } else {
        fn('gameAudio')?.()?.playSave?.({ own: Boolean(own) });
      }
      if ((state.phase !== undefined && state.phase !== 'play') || own || state.online?.active || state.goalReplay || state.theater || state.activePlayback) return;
      const viewBodies = state.fieldView?.bodies || state.bodies || [];
      const simBodies = state.simBodies || [];
      const idx = viewBodies.indexOf(body);
      const simBody = idx >= 0 && simBodies[idx] ? simBodies[idx] : body;
      const classic = Boolean(fn('classicMode')?.());
      for (const changed of ububallMatch.gainMeter(P, simBodies, state.stats, simBody, ububallMatch.METER.save, classic)) {
        const cIdx = simBodies.indexOf(changed);
        const vb = cIdx >= 0 && viewBodies[cIdx] ? viewBodies[cIdx] : changed;
        vb.meter = changed.meter;
        state.dirtyMeters?.add(vb);
      }
    }

    function contactMeter(a, b, speed, passerSlot = -1) {
      const P = getP(), ububallMatch = getMatch();
      if ((state.phase !== undefined && state.phase !== 'play') || state.online?.active || state.goalReplay || state.theater || state.activePlayback) return;
      const tick = (state.matchTicks || 0) + Math.round(((state.elapsed || 0) + P.DT) / P.DT);
      const viewBodies = state.fieldView?.bodies || state.bodies || [];
      const simBodies = state.simBodies || [];
      const ia = viewBodies.indexOf(a), ib = viewBodies.indexOf(b);
      const sa = ia >= 0 && simBodies[ia] ? simBodies[ia] : a;
      const sb = ib >= 0 && simBodies[ib] ? simBodies[ib] : b;
      const classic = Boolean(fn('classicMode')?.());
      for (const changed of ububallMatch.contactMeter(P, simBodies, state.stats, sa, sb, speed, tick, classic, passerSlot)) {
        const cIdx = simBodies.indexOf(changed);
        const vb = cIdx >= 0 && viewBodies[cIdx] ? viewBodies[cIdx] : changed;
        vb.meter = changed.meter;
        state.dirtyMeters?.add(vb);
      }
    }

    function flushMeters() {
      const meters = state.dirtyMeters;
      if (!meters) return;
      const setFill = fn('setMeterFill') ?? presFallback()?.setMeterFill;
      const P = getP();
      const hudSuperText = $('stadium-super-text');
      for (const body of meters) {
        const idx = body.playerIndex;
        const meterVal = Math.max(0, Math.min(100, body.meter || 0));
        const fill = $(`super-fill-${idx}`), pct = $(`super-pct-${idx}`), panel = $(`super-panel-${idx}`);
        if (fill) setFill?.(fill, body.meter);
        panel?.classList?.toggle?.('ready', !body.superArm && body.meter >= 100);
        if (pct && !body.carded && !body.stunned && !body.superArm) {
          const pctTxt = body.meter >= 100 ? 'Ready' : `${Math.floor(meterVal)}%`;
          if (pct.textContent !== pctTxt) pct.textContent = pctTxt;
        }
        if (hudSuperText && idx === state.selected && !body.carded && !body.stunned && !body.superArm) {
          const s = body.equippedSuper || P?.SUPERS?.[0];
          const sName = s?.name || 'Super';
          const hudTxt = `${sName} ${Math.floor(meterVal)}%`;
          if (hudSuperText.textContent !== hudTxt) hudSuperText.textContent = hudTxt;
        }
        const pill = $(`portrait-pill-${idx}`);
        if (pill) {
          pill.style?.setProperty?.('--meter', `${meterVal.toFixed(1)}%`);
          pill.classList?.toggle?.('ready', !body.superArm && body.meter >= 100);
          pill.classList?.toggle?.('armed', Boolean(body.superArm));
        }
        const drawerSuper = $('stat-drawer-super');
        if (drawerSuper?.dataset?.player != null && Number(drawerSuper.dataset.player) === idx) {
          const drawerFill = $('stat-drawer-super-fill');
          const drawerPct = $('stat-drawer-super-pct');
          if (drawerFill) setFill?.(drawerFill, body.meter);
          drawerSuper.classList?.toggle?.('ready', !body.superArm && body.meter >= 100);
          drawerSuper.classList?.toggle?.('armed', Boolean(body.superArm));
          if (drawerPct) {
            const drawerTxt = formatDrawerSuperStatus(body);
            if (drawerPct.textContent !== drawerTxt) drawerPct.textContent = drawerTxt;
          }
        }
      }
      meters.clear();
    }

    return { creditSave, contactMeter, flushMeters };
  }

  function createPlanClockController(deps = {}) {
    const { state, fn, $, getDoc, getPerf } = makeLookup(deps);
    const getMatch = () => deps.ububallMatch ?? state.ububallMatch;

    function localPlayBlocked() {
      const doc = getDoc();
      const isHome = fn('isHomeShot') ?? (() => state.shot === 'home' || state.shot === 'lobby');
      const rosterDlg = $('roster-dialog');
      return (state.shot !== 'match' && state.shot !== 'replay' && !(state.demo && isHome())) ||
        Boolean(doc?.hidden) ||
        Boolean(rosterDlg?.classList?.contains?.('open') || rosterDlg?.open) ||
        Boolean($('pause-menu')?.open) ||
        Boolean($('match-help')?.open) ||
        Boolean($('stats-dialog')?.open) ||
        Boolean(doc?.querySelector?.('.game-dialog[open]')) ||
        Boolean(state.foulInfo && !state.online?.active);
    }

    function startPlanClock() {
      const ububallMatch = getMatch();
      const now = getPerf()?.now?.() ?? 0;
      state.planDeadline = now + (ububallMatch.planningMilliseconds(state.fieldView?.mode ?? state.matchMode) ?? Infinity);
      state.planPausedAt = localPlayBlocked() ? now : null;
    }

    function updateLocalPlanClock(blocked = localPlayBlocked()) {
      const blitz = Boolean(fn('blitzMode')?.());
      if (state.online?.active || state.phase !== 'plan' || !blitz) return;
      const now = getPerf()?.now?.() ?? 0;
      if (blocked) state.planPausedAt ??= now;
      else if (state.planPausedAt !== null) {
        state.planDeadline += now - state.planPausedAt;
        state.planPausedAt = null;
      }
    }

    function drainClock(hidden, left) {
      const ububallMatch = getMatch();
      const strip = $('clock-strip');
      if (strip && strip.hidden !== hidden) strip.hidden = hidden;
      if (!hidden && strip?.firstChild) {
        const xf = `scaleX(${Math.min(1, left / ububallMatch.planningMilliseconds('blitz'))})`;
        if (strip.firstChild.style.transform !== xf) strip.firstChild.style.transform = xf;
      }
    }

    function updateClock() {
      const setHidden = (el, next) => { if (el && el.hidden !== next) el.hidden = next; };
      const clock = $('blitz-clock');
      const blitz = Boolean(fn('blitzMode')?.());
      if (state.online?.active) {
        const s = state.online.state;
        const hideClock = !blitz || s?.phase !== 'plan';
        setHidden(clock, hideClock);
        const left = hideClock ? 0 : Math.max(0, s.deadline === null ? s.remaining : s.deadline - state.online.now());
        if (!hideClock && clock) {
          const txt = Math.ceil(left / 1000) + 's';
          if (clock.textContent !== txt) clock.textContent = txt;
        }
        drainClock(hideClock, left);
        const other = s ? 1 - s.seat : 1;
        const hideForfeit = !s || s.spectator || s.phase === 'over' || !s.connected[s.seat] || s.connected[other] || s.disconnectedAt[other] === null || state.online.now() - s.disconnectedAt[other] < 60000;
        setHidden($('online-forfeit'), hideForfeit);
        return;
      }
      const hideClock = !blitz || state.phase !== 'plan';
      setHidden(clock, hideClock);
      const left = hideClock ? 0 : Math.max(0, state.planDeadline - (state.planPausedAt ?? getPerf()?.now?.() ?? 0));
      if (!hideClock && clock) {
        const txt = Math.ceil(left / 1000) + 's';
        if (clock.textContent !== txt) clock.textContent = txt;
      }
      drainClock(hideClock, left);
    }

    return { startPlanClock, localPlayBlocked, updateLocalPlanClock, updateClock, drainClock };
  }

  function stepFrameEffects(deps = {}) {
    const { state, fn } = makeLookup(deps);
    const ububallMatch = deps.ububallMatch ?? state.ububallMatch;
    const delta = deps.delta ?? 0;
    const active = deps.active !== undefined ? deps.active : !fn('localPlayBlocked')?.();
    const phase = state.phase;
    const theater = state.theater;
    const goalReplay = state.goalReplay;
    const postGoal = state.postGoal;
    const pulseFrozen = Boolean(fn('pulseMode')?.()) && (state.roundTurns || 0) > 0 && (phase === 'plan' || phase === 'cpu-wait' || phase === 'waiting');
    const exporting = typeof fn('isExporting') === 'function' ? fn('isExporting')() : Boolean(theater?.exporting);
    const clockNow = typeof fn('clockNow') === 'function' ? fn('clockNow')() : 0;
    let speed = 1;
    if (!active || clockNow < (state.hitStopUntil || 0) || pulseFrozen) speed = 0;
    else if (theater) speed = theater.paused || exporting ? 0 : theater.speed;
    else if (goalReplay) speed = goalReplay.played >= goalReplay.total ? 0.5 : ububallMatch.replaySpeed(goalReplay.total - goalReplay.played);
    else if (postGoal) speed = ububallMatch.postGoalSpeed(postGoal.ticks);
    const simDelta = delta * speed;
    if (active && !theater?.paused && !exporting) fn('updatePopups')?.(delta, state.fieldEffects?.popups ?? state.popups);
    if (active && !theater?.paused && !exporting && !pulseFrozen) fn('updateEffects')?.(simDelta);
    let handledReplay = false;
    if (theater) {
      handledReplay = true;
      if (active && !exporting) fn('advanceReplay')?.(delta);
    }
    return { simDelta, speed, pulseFrozen, exporting, handledReplay };
  }

  function createFrameLoop(deps = {}) {
    const { state, fn, $, getPerf, getRaf } = makeLookup(deps);
    const getP = () => deps.P ?? state.P;
    const getMatch = () => deps.ububallMatch ?? state.ububallMatch;
    const postGoalState = { steps: 0, onTick: null };

    function frame(time) {
      const P = getP(), ububallMatch = getMatch();
      const delta = state.lastTime ? Math.min(1 / 15, Math.max(0, (time - state.lastTime) / 1000)) : 0;
      state.lastTime = time;
      const active = !fn('localPlayBlocked')?.();
      fn('updateLocalPlanClock')?.(!active);
      fn('updateClock')?.();
      const perfNow = getPerf()?.now?.() ?? 0;
      if (state.online?.active) {
        if (state.phase === 'plan') state.online.send?.(fn('networkMoves')?.());
        if (state.goalReplayAt && perfNow >= state.goalReplayAt) {
          state.goalReplayAt = 0;
          fn('startGoalReplay')?.();
        }
      } else {
        if (active && fn('blitzMode')?.() && state.phase === 'plan' && perfNow >= state.planDeadline) $('launch')?.click?.();
        if (state.goalReplayAt) {
          if (active) state.goalReplayDelayMs -= delta * 1000;
          if (active && state.goalReplayDelayMs <= 0) {
            state.goalReplayAt = 0; state.goalReplayDelayMs = 0;
            if (state.phase === 'over' && !state.demo) {
              fn('banner')?.(state.scores[0] > state.scores[1] ? 'You win!' : 'CPU wins!', 3500, state.scores[0] > state.scores[1] ? 'home' : 'away');
            }
            fn('startGoalReplay')?.();
          }
        }
      }
      if ((state.goalReplay && !state.demo) || (state.replaySkip && !state.replaySkip.hidden)) fn('updateReplaySkip')?.(state.goalReplay);
      if (!active) { state.lastTime = 0; state.accumulator = 0; postGoalState.steps = 0; }
      const fx = state.fieldEffects || {};
      const hadEffects = fx.particles?.length || fx.fireworks?.length || fx.trails?.some?.(trail => trail.length) || fx.shockwaves?.length || fx.goalCall || fx.fireWarp || fx.koWarp ||
        fx.ripples?.length || fx.pings?.length || fx.popups?.length || fx.kickoffGlow || fx.goalSweep || (fx.danger?.[0] > .02) || (fx.danger?.[1] > .02);
      const { simDelta, handledReplay } = stepFrameEffects({ state, actions: deps, ububallMatch, delta, active });
      if (!handledReplay) {
        if ((state.phase === 'play' || state.postGoal) && active && !state.online?.active) {
          const _tSim = state.bench?.rec ? (getPerf()?.now?.() ?? 0) : 0;
          const syncTick = fn('syncTickBodies');
          const syncView = fn('syncViewBodies');
          const stepSync = typeof syncTick === 'function' ? syncTick : syncView;
          const capPose = fn('capturePose');
          const clrPose = fn('clearPose');
          const syncInterp = fn('syncInterpolatedBodies');
          const clockNowFn = fn('clockNow');
          const hitStop = () => state.hitStopUntil || 0;
          const liveFx = deps.liveFx ?? state.liveFx;
          if (state.postGoal) {
            postGoalState.onTick = () => { state.elapsed += P.DT; };
            if (!fn('advancePostGoal')?.(state.postGoal, postGoalState, simDelta, liveFx, () => stepSync?.(state.postGoal.sim || state.simBodies, 0), 48, hitStop,
              typeof capPose === 'function' ? () => capPose(state.postGoal.sim || state.simBodies, 0) : null)) state.postGoal = null;
            syncView?.(state.postGoal?.sim || state.simBodies, 0);
            if (state.postGoal && typeof syncInterp === 'function') {
              syncInterp((clockNowFn?.() ?? 0) < (state.hitStopUntil || 0) ? 1 : postGoalState.steps, state.postGoal.sim || state.simBodies, 0);
            }
          } else {
            if ((clockNowFn?.() ?? 0) < (state.hitStopUntil || 0)) state.accumulator = 0; else state.accumulator += simDelta;
            let steps = 0, steppedPlay = false;
            while (steps++ < 48 && state.accumulator >= P.DT && state.phase === 'play') {
              steppedPlay = true;
              if (typeof capPose === 'function') capPose(state.simBodies, 0);
              const tick = ububallMatch.playTick(P, state.simBodies, state.play, liveFx, state.tally), { goal } = tick;
              state.elapsed += P.DT; state.accumulator -= P.DT;
              ububallMatch.lapseFouls(P, state.simBodies, state.fouls); fn('traceGuide')?.(state.simBodies);
              stepSync?.(state.simBodies, 0);
              fn('applyTickEvents')?.(state.simBodies, {
                saves: tick.saves, struck: tick.struck, stop: tick.stop, applyIron: false,
                viewFn: (_, s) => (state.fieldView?.bodies || state.bodies)[s.index], isGoal: goal !== null,
                onStop: () => { state.accumulator = 0; if (typeof clrPose === 'function') clrPose(); }
              });
              fn('noteEvents')?.(Math.round(state.elapsed / P.DT), tick.saves, tick.stop);
              fn('recordTrails')?.();
              if (goal !== null || P.settled(state.simBodies) || Math.round(state.elapsed / P.DT) >= ububallMatch.turnTicks(state.fieldView?.mode ?? state.matchMode)) {
                postGoalState.steps = 0;
                fn('finishTurn')?.(goal);
                if (typeof clrPose === 'function') clrPose();
                if (goal !== null) break;
              }
            }
            if (steppedPlay && state.phase === 'play') syncView?.(state.simBodies, 0);
            if (state.phase === 'play' && typeof syncInterp === 'function') {
              syncInterp((clockNowFn?.() ?? 0) < (state.hitStopUntil || 0) ? 1 : state.accumulator / P.DT, state.simBodies, 0);
            }
          }
          if (state.bench?.rec) state.bench.rec.simMs += ((getPerf()?.now?.() ?? 0) - _tSim);
          if (state.phase === 'play' || state.postGoal) fn('emitSkaterEffects')?.(simDelta);
          fn('draw')?.();
        } else if (state.goalReplay && active) {
          fn('advanceGoalReplay')?.(delta);
        } else if (state.online?.active && active && (state.postGoal || (state.onlineReplay && !state.onlineReplay.settledSynced))) {
          const turnRunning = Boolean(state.onlineReplay && (state.onlineReplay.currentTick ?? 0) < state.onlineReplay.ticks);
          if (turnRunning) fn('playOnlineReplay')?.();
          else if (state.postGoal) {
            postGoalState.onTick = null;
            const seat = state.postGoal.seat ?? state.online.state?.seat ?? 0;
            const replayFx = deps.replayFx ?? state.replayFx;
            const capPose = fn('capturePose');
            const syncView = fn('syncViewBodies');
            const syncInterp = fn('syncInterpolatedBodies');
            const clockNowFn = fn('clockNow');
            if (!fn('advancePostGoal')?.(state.postGoal, postGoalState, simDelta, replayFx, () => syncView?.(state.postGoal.sim, seat), 48, () => state.hitStopUntil || 0,
              typeof capPose === 'function' ? () => capPose(state.postGoal.sim, seat) : null)) state.postGoal = null;
            if (state.postGoal && typeof syncInterp === 'function') {
              syncInterp((clockNowFn?.() ?? 0) < (state.hitStopUntil || 0) ? 1 : postGoalState.steps, state.postGoal.sim, seat);
            }
          }
          if ((state.onlineReplay && (state.onlineReplay.currentTick ?? 0) < state.onlineReplay.ticks) || state.postGoal) fn('emitSkaterEffects')?.(simDelta);
          fn('draw')?.();
        } else if (active && (state.dragDirty || hadEffects || (state.phase === 'plan' && (deps.presenter ?? state.presenter)?.getPredictionCache?.()?.data?.goal !== null) || (!(deps.reducedMotion ?? state.reducedMotion)?.matches && (fn('foulsShowing')?.() || (state.fieldView?.bodies || state.bodies || []).some(b => b.meter >= 100 || b.superArm || b.superActive || (P.dazeSlow && P.dazeSlow(b) > 0)))))) {
          if (state.dragDirty) { state.dragDirty = false; state.drawingDragFrame = true; fn('sync')?.(); }
          try { fn('draw')?.(); } finally { state.drawingDragFrame = false; }
        }
      }
      if (state.firstTurnStep !== null) fn('animateFirstTurnGuide')?.(time, active);
      fn('flushMeters')?.();
      getRaf()?.(frame);
    }

    return { postGoalState, frame };
  }

  function createSummaryController(deps = {}) {
    const { state, fn, $ } = makeLookup(deps);
    const getMatch = () => deps.ububallMatch ?? state.ububallMatch;

    function closeSummary() {
      if ($('stats-dialog')?.open) $('stats-dialog').close();
      if ($('match-summary')?.open) $('match-summary').close();
    }

    function openSummary() {
      const summary = $('match-summary');
      if (state.demo || summary.open) return;
      const s = state.online?.state;
      const scores = state.scores;
      const winner = s ? (s.winner == null ? null : s.winner === s.seat ? 0 : 1)
        : (scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1);
      const winnerName = winner === null ? null : $(winner ? 'opponent-label' : 'home-label').textContent;
      const { tally: t } = fn('viewTally')();
      const ububallMatch = getMatch();
      const h = winner === null ? { comeback: false, shutout: false } : ububallMatch.honours(t, scores, winner);
      const matchMvpFn = fn('matchMvp') ?? statsFallback()?.matchMvp;
      const mvp = matchMvpFn({ ...t, topShot: t.topSpeed });
      $('summary-score').textContent = scores.join(' – ');
      $('summary-winner').textContent = winner === null ? 'Match ended' : winner === 0 && !s?.spectator ? 'You win!' : `${winnerName} wins!`;
      $('summary-honours').textContent = s && s.game.winner == null ? (s.left?.some(Boolean) ? 'Opponent left' : 'Won by forfeit') :
        [h.comeback && 'Comeback from 3 down!', h.shutout && 'Shutout!'].filter(Boolean).join(' ');
      $('summary-mvp').textContent = mvp === null ? 'No MVP awarded' : `MVP · ${state.fieldView.entries[mvp].model.parts.fullName}`;
      $('summary-play-again').hidden = Boolean(s);
      $('summary-rematch').hidden = !s;
      if (s) fn('updateRematch')?.(s);
      else $('summary-rematch-status').textContent = '';
      summary.showModal();
    }

    return { closeSummary, openSummary };
  }

  function createCpuTurnPlanner(deps = {}) {
    const { state, fn } = makeLookup(deps);

    function prepareCPU(initialPlans = null) {
      const ububallCPU = deps.ububallCPU ?? state.ububallCPU ?? root.ububallCPU;
      const ububallMatch = deps.ububallMatch ?? state.ububallMatch;
      const generation = (state.cpuGeneration = (state.cpuGeneration || 0) + 1);
      state.cpuDone = false;
      state.cpuClient?.cancel?.();
      if (state.online?.active) return;
      state.cpu = Array.isArray(initialPlans) && initialPlans.length === 3
        ? initialPlans
        : ububallCPU.cpuPlans(state.simBodies, () => .5, state.scores);
      const turns = !state.demo ? state.recording?.turns : null;
      let history;
      if (turns?.length) {
        history = [];
        let rt = 0;
        const startIdx = Math.max(0, turns.length - 32);
        for (let i = 0; i < turns.length; i++) {
          const t = turns[i];
          const isKick = i === 0 || turns[i - 1]?.goal != null;
          if (isKick) rt = 0;
          const curRt = rt++;
          if (i < startIdx) continue;
          if (!t?.bodies || t.bodies.length < 7 || !t.plans || t.plans.length < 6) continue;
          history.push({
            roundTurns: isKick ? 0 : Math.max(1, curRt),
            bodies: t.bodies.map(b => ({ x: b.x, y: b.y, meter: b.meter, stunned: b.stunned, carded: b.carded })),
            plans: t.plans
          });
        }
      }
      const seed = ((typeof state.cpuMatchSeed === 'number' ? state.cpuMatchSeed : 0) ^ Math.imul(state.turn, 2654435761)) >>> 0;
      const mode = state.fieldView?.mode ?? state.matchMode;
      const demoLevels = state.demoLevels || ['medium', 'hard'];
      state.cpuReady = state.cpuClient.plan({
        version: ububallMatch.VERSION,
        mode,
        bodies: state.simBodies,
        stats: state.stats,
        scores: state.scores,
        turn: state.turn,
        fouls: state.fouls,
        clock: state.matchTicks,
        roundTurns: state.roundTurns,
        play: ububallMatch.newPlay(state.play)
      }, { level: state.demo ? demoLevels[1] : state.cpuLevel, seed, history }).then(result => {
        if (generation !== state.cpuGeneration || !result || state.online?.active) return;
        if (result.error) console.warn('CPU search unavailable; using baseline plan.');
        else {
          state.cpu = result.plans;
          state.cpuDone = true;
          if (state.phase === 'plan') fn('saveActiveMatch')?.();
        }
      });
    }

    return { prepareCPU };
  }

  function positionSpinControl(deps = {}) {
    const { state, fn, $ } = makeLookup(deps);
    const control = $('field-spin');
    if (!control) return;
    if (control.hidden) control.hidden = false;
    const visible = state.shot === 'match' && !state.cameraMove && state.phase === 'plan' && state.drag === null && Boolean(state.spinSlider);
    const vis = visible ? 'visible' : 'hidden';
    if (control._lastVis !== vis) { control._lastVis = vis; control.style.visibility = vis; }
    const nextInert = !visible;
    if (control.inert !== nextInert) control.inert = nextInert;
    if (!visible) return;
    const viewBodies = state.fieldView?.bodies || state.bodies;
    const b = viewBodies[state.selected];
    const stagePoint = fn('stagePoint');
    const center = stagePoint(b), r = state.fieldBox;
    const scale = (deps.gameUi ?? state.gameUi).scale();
    const width = r.controlWidth, height = r.controlHeight;
    const P = deps.P ?? state.P;
    const impFn = fn('impulseGeometry') ?? ((body, pl) => presFallback()?.impulseGeometry?.(P, body, pl));
    const arrow = stagePoint(impFn(b, state.plans[state.selected]));
    let y = arrow.y > center.y + 8 * scale ? center.y - height - b.radius * (state.fieldView?.portrait ? r.height / 1000 : r.width / 1000) - 24 * scale
      : center.y + b.radius * (state.fieldView?.portrait ? r.height / 1000 : r.width / 1000) + 5 * scale;
    const x = Math.max(6 * scale, Math.min(r.stageWidth - width - 6 * scale, center.x - width / 2));
    y = Math.max(6 * scale, Math.min(r.stageHeight - height - 6 * scale, y));
    const xf = `translate3d(${x}px, ${y}px, 0)`;
    if (control._lastXf !== xf) { control._lastXf = xf; control.style.transform = xf; }
  }

  function createBannerController(deps = {}) {
    const { $, getSetTimeout, getClearTimeout } = makeLookup(deps);
    let bannerTimer = 0, bannerGone = null;

    function restartClassAnimation(el, cls, durationMs = 0) {
      if (!el) return;
      if (!el.classList.contains?.(cls)) {
        el.classList.add(cls);
        return;
      }
      const anims = typeof el.getAnimations === 'function' ? el.getAnimations() : null;
      if (anims && anims.length) {
        for (const a of anims) {
          if (durationMs > 0) a.effect?.updateTiming?.({ duration: durationMs });
          a.cancel?.();
          a.play?.();
        }
      } else {
        el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
      }
    }

    function banner(text, ms = 1200, tone = '') {
      const el = $('field-banner');
      const clearT = getClearTimeout();
      const setT = getSetTimeout();
      clearT?.(bannerTimer); bannerGone?.();
      if (el.textContent !== text) el.textContent = text;
      if (el.dataset.tone !== tone) el.dataset.tone = tone;
      el.style.setProperty('--banner-ms', ms + 'ms');
      restartClassAnimation(el, 'show', ms);
      return new Promise(resolve => {
        bannerGone = resolve;
        bannerTimer = setT ? setT(() => { el.classList.remove('show'); bannerGone = null; resolve(); }, ms) : 0;
      });
    }

    return { restartClassAnimation, banner };
  }

  function bindMatchShortcuts(deps = {}) {
    const { state, fn, $, getDoc, getRaf } = makeLookup(deps);
    const doc = getDoc();
    const isMatchShot = () => (fn('isMatchShot') ? fn('isMatchShot')() : state.shot === 'match' || state.shot === 'replay');
    const playableShot = () => (fn('playableShot') ? fn('playableShot')() : state.shot === 'match' && !state.cameraMove);

    function onKeydown(e) {
      if (e.key === 'Escape') {
        if (state.foulInfo) fn('closeFoulInfo')?.();
        else if (isMatchShot() && !fn('ownsFullscreen')?.() && !doc?.querySelector?.('dialog[open]')) fn('openPause')?.();
        return;
      }
      if (!playableShot() || state.theater || e.ctrlKey || e.altKey || e.metaKey) return;
      if (doc?.querySelector?.('dialog[open]') || e.target?.closest?.('button, a, input, select, textarea, [tabindex], [contenteditable]')) return;

      if (e.key === ' ') {
        e.preventDefault();
        state.selected = (state.selected + 1) % 3;
        fn('sync')?.(); fn('draw')?.();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        $('launch')?.click?.();
        return;
      }
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault();
        state.selected = Number(e.key) - 1;
        fn('sync')?.(); fn('draw')?.();
        return;
      }
      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        fn('toggleGuard')?.(state.selected);
        return;
      }
      const repeatDefer = Boolean(e.repeat && typeof getRaf() === 'function');
      const persistKeyChange = () => {
        if (e.repeat && typeof fn('scheduleSaveActiveMatch') === 'function') fn('scheduleSaveActiveMatch')();
        else fn('saveActiveMatch')?.();
      };
      const knobKeyMap = {
        w: ['power', 10, 5], W: ['power', 10, 5],
        s: ['power', -10, -5], S: ['power', -10, -5],
        a: ['angle', -15, -5], A: ['angle', -15, -5],
        d: ['angle', 15, 5], D: ['angle', 15, 5],
        q: ['spin', -20, -10], Q: ['spin', -20, -10],
        e: ['spin', 20, 10], E: ['spin', 20, 10]
      };
      const spec = knobKeyMap[e.key];
      if (spec && fn('knobEditable')?.(state.selected)) {
        e.preventDefault();
        const [kind, shiftDelta, baseDelta] = spec;
        fn('setKnob')?.(kind, state.selected, fn('knobValue')(kind, state.selected) + (e.shiftKey ? shiftDelta : baseDelta), repeatDefer);
        persistKeyChange();
      }
    }

    doc?.addEventListener?.('keydown', onKeydown);
    return onKeydown;
  }

  function bindSpinSlider(deps = {}) {
    const { state, fn, $, getRaf, getSetTimeout, getClearTimeout } = makeLookup(deps);
    let saveActiveMatchTimer = 0;

    function cancelScheduledSave() {
      if (!saveActiveMatchTimer) return;
      const clearT = getClearTimeout();
      if (typeof clearT === 'function') clearT(saveActiveMatchTimer);
      saveActiveMatchTimer = 0;
    }

    function flushScheduledSave() {
      if (!saveActiveMatchTimer) return;
      cancelScheduledSave();
      if (state.phase === 'plan') fn('saveActiveMatch')?.();
    }

    function scheduleSaveActiveMatch() {
      if (state.phase !== 'plan') return;
      const setT = getSetTimeout();
      if (typeof setT !== 'function') { fn('saveActiveMatch')?.(); return; }
      cancelScheduledSave();
      saveActiveMatchTimer = setT(() => {
        saveActiveMatchTimer = 0;
        if (state.phase === 'plan') fn('saveActiveMatch')?.();
      }, 200);
    }

    const spinEl = $('shot-spin');
    if (spinEl) {
      spinEl.oninput = () => {
        if (!fn('knobEditable')?.(state.selected)) return;
        state.plans[state.selected].spin = Number(spinEl.value) * 0.01;
        state.plans[state.selected].guard = false;
        if (typeof getRaf() === 'function') state.dragDirty = true;
        else { fn('sync')?.(); fn('draw')?.(); }
      };
      spinEl.onchange = () => {
        if (state.dragDirty) { state.dragDirty = false; fn('sync')?.(); fn('draw')?.(); }
        if (state.phase === 'plan') fn('saveActiveMatch')?.();
      };
    }

    return { cancelScheduledSave, flushScheduledSave, scheduleSaveActiveMatch };
  }

  function createDemoFingerController(deps = {}) {
    const { state, fn, $, getPerf, getRaf, getSetTimeout } = makeLookup(deps);

    function placeFinger(x, y, rects = null) {
      const finger = $('demo-finger');
      const stage = rects?.stage || finger.parentElement.getBoundingClientRect();
      const p = rects?.canvas ? fn('boxPoint')(rects.canvas, { x, y }) : fn('screenPoint')({ x, y });
      finger.style.left = p.x - stage.left + 'px';
      finger.style.top = p.y - stage.top + 'px';
    }

    function hideFinger() {
      const finger = $('demo-finger');
      finger?.toggleAttribute?.('hidden', true);
      finger?.classList?.remove?.('pressed');
    }

    async function demoAim(run, i, target, current) {
      const viewBodies = state.fieldView?.bodies || state.bodies;
      const b = viewBodies[i];
      state.selected = i; fn('sync')?.(); fn('draw')?.();
      const demoWait = fn('demoWait');
      if (b.stunned || target.guard || !(target.power > 0)) {
        state.plans[i] = { ...target }; fn('sync')?.(); fn('draw')?.();
        await demoWait(run, 500);
        return;
      }
      state.plans[i] = { ...target, power: 0 };
      placeFinger(b.x, b.y);
      const fingerEl = $('demo-finger');
      fingerEl.toggleAttribute('hidden', false);
      await demoWait(run, 350);
      if (!current()) { hideFinger(); return; }
      fingerEl.classList.add('pressed');
      await demoWait(run, 200);
      const perf = getPerf();
      const raf = getRaf();
      const setT = getSetTimeout();
      const began = perf.now(), ms = 900;
      const useRaf = typeof raf === 'function';
      const nextTick = useRaf ? raf : stepFn => setT(stepFn, 16);
      const canvas = state.fieldView?.canvas;
      let rects = !state.layoutDirty && fingerEl?.parentElement
        ? { stage: fingerEl.parentElement.getBoundingClientRect(), canvas: canvas.getBoundingClientRect() }
        : null;
      await new Promise(resolve => {
        const step = () => {
          const now = perf.now();
          if (run !== state.demoRun || !current()) { resolve(); return; }
          if (state.layoutDirty || !rects) {
            rects = fingerEl?.parentElement
              ? { stage: fingerEl.parentElement.getBoundingClientRect(), canvas: canvas.getBoundingClientRect() }
              : null;
          }
          const k = Math.min(1, (now - began) / ms), eased = 1 - (1 - k) ** 3;
          state.plans[i] = { ...target, power: target.power * eased };
          const arrow = fn('impulseGeometry')(b, state.plans[i]);
          placeFinger(arrow.x, arrow.y, rects);
          if (useRaf) state.dragDirty = true; else { fn('sync')?.(); fn('draw')?.(); }
          if (k < 1) nextTick(step); else resolve();
        };
        nextTick(step);
      });
      if (run !== state.demoRun) throw state.DEMO_STOP;
      if (!current()) { hideFinger(); return; }
      state.plans[i] = { ...target }; fn('sync')?.(); fn('draw')?.();
      await demoWait(run, 300);
      hideFinger();
      await demoWait(run, 300);
    }

    return { placeFinger, hideFinger, demoAim };
  }

  function createGoalReplayController(deps = {}) {
    const { state, fn, getPerf } = makeLookup(deps);
    const getP = () => deps.P ?? state.P;
    const getMatch = () => deps.ububallMatch ?? state.ububallMatch;
    let replayTickStruck = false;

    const currentReplay = () => state.activePlayback || state.theater || null;
    const replayHitStop = th => th.fx?.hitStopUntil ?? state.hitStopUntil ?? 0;

    function activeOnlineSim() {
      const pg = state.postGoal || null;
      const onl = state.online || null;
      const onlRep = state.onlineReplay || null;
      if (pg?.sim) return pg.sim;
      if (onlRep) {
        if ((onlRep.currentTick ?? 0) < onlRep.ticks) return onlRep.simBodies;
        if (onlRep.postGoalSim) return onlRep.postGoalSim;
      }
      return onl?.state?.game?.bodies ?? onlRep?.simBodies;
    }

    function shownSim() {
      const rep = state.goalReplay || currentReplay();
      if (rep) return rep.sim;
      if (state.online?.active) return activeOnlineSim();
      return state.postGoal?.sim ?? state.simBodies;
    }

    function shownSeat() {
      const rep = state.goalReplay || currentReplay();
      if (rep) return rep.seat;
      if (state.online?.active) return state.postGoal?.seat ?? state.online.state?.seat ?? 0;
      return 0;
    }

    const replayView = (cb, th = currentReplay()) => fn('toViewBody')(
      cb,
      th ? th.sim : shownSim(),
      th ? th.seat : shownSeat(),
      th?.bodies || state.fieldView?.bodies || null
    );

    const syncReplay = (th = currentReplay()) => fn('syncViewBodies')(
      th ? th.sim : shownSim(),
      th ? th.seat : shownSeat(),
      th?.bodies || state.fieldView?.bodies || null,
      th ? th.anonymous : undefined,
      th?.exporting ? null : undefined,
      th?.entries
    );

    function syncReplayTick(th = currentReplay()) {
      const syncTick = fn('syncTickBodies');
      if (typeof syncTick === 'function' && !th) {
        return syncTick(shownSim(), shownSeat(), state.fieldView?.bodies || null);
      }
      return syncReplay(th);
    }

    function replayEvents(turn, tick, sim) {
      const saves = turn.saves.filter(s => s.tick === tick);
      const stop = turn.stops.find(s => s.tick === tick)?.ms;
      const struck = replayTickStruck;
      replayTickStruck = false;
      fn('applyTickEvents')?.(sim, { saves, struck, stop, applyIron: true, syncFn: syncReplay, viewFn: b => replayView(b) });
    }

    const replayFx = {
      hit: contact => {
        if (contact.spinStruck && (state.goalReplay || currentReplay())) replayTickStruck = true;
        syncReplayTick();
        fn('handleCollision')?.({ ...contact, a: replayView(contact.a), b: replayView(contact.b) });
      },
      wall: (body, velocity, wallType, nx, ny, rimmed = false) => {
        syncReplayTick();
        const seat = shownSeat();
        fn('handleWall')?.(replayView(body), velocity, wallType, seat ? -nx : nx, seat ? -ny : ny, rimmed);
      },
      shock: (source, radius, type = null) => {
        syncReplayTick();
        fn('handleShockwave')?.(replayView(source), radius, type);
      },
      super: (key, stage, body, target = null) => {
        syncReplayTick();
        fn('handleSuper')?.(key, stage, replayView(body), target ? replayView(target) : null);
      }
    };

    function nextReplaySegment() {
      const P = getP();
      const before = fn('trailPositions')?.() || [];
      const r = state.goalReplay, segment = r.segments[++r.index];
      r.sim = stripPresentation(structuredClone(segment.bodies)); r.tick = 0;
      P.startTurn(r.sim, segment.plans, replayFx.super);
      syncReplay();
      fn('clearDiscontinuousTrails')?.(before);
    }

    function restartGoalReplay() {
      Object.assign(state.goalReplay, { index: -1, played: 0, steps: 0, doneAt: 0, doneHoldMs: 0, loops: (state.goalReplay.loops || 0) + 1 });
      fn('clearEffects')?.();
      nextReplaySegment();
    }

    function endGoalReplay() {
      state.goalReplayAt = 0;
      state.goalReplayDelayMs = 0;
      if (!state.goalReplay) return;
      const viewBodies = state.fieldView?.bodies || state.bodies || [];
      state.scoringPlayer = viewBodies[state.goalReplay.scorer] || null;
      state.goalReplay = null;
      fn('clearPose')?.();
      fn('clearEffects')?.();
      syncReplay();
      viewBodies.slice(0, 6).forEach(b => state.dirtyMeters?.add(b));
      fn('sync')?.(); fn('draw')?.();
    }

    function startGoalReplay() {
      const P = getP();
      const viewBodies = state.fieldView?.bodies || state.bodies || [];
      if (state.postGoal) {
        if (state.postGoal.sim) P.stop(state.postGoal.sim);
        P.stop(viewBodies);
        state.postGoal = null;
      }
      const segments = (state.playSegments || []).filter(s => s.ticks);
      if (!segments.length || (state.online?.active && state.online.state?.phase !== 'resolving')) {
        if (!state.online?.active && state.phase === 'over') fn('openSummary')?.();
        return;
      }
      endGoalReplay();
      const scorer = viewBodies.indexOf(state.scoringPlayer);
      state.goalReplay = {
        segments,
        total: segments.reduce((n, s) => n + s.ticks, 0),
        seat: state.online?.active ? state.online.state.seat : 0,
        scorer,
        started: getPerf()?.now?.() ?? 0,
        elapsedMs: 0
      };
      state.scoringPlayer = viewBodies[scorer] || null;
      restartGoalReplay();
      fn('draw')?.();
    }

    function advanceGoalReplay(delta) {
      const P = getP(), ububallMatch = getMatch();
      delta = Math.min(1 / 15, Math.max(0, delta));
      const r = state.goalReplay;
      r.elapsedMs = (r.elapsedMs || 0) + delta * 1000;
      const clockNow = fn('clockNow')?.() ?? 0;
      if (clockNow < (state.hitStopUntil || 0)) { fn('draw')?.(); return; }
      const now = getPerf()?.now?.() ?? 0;
      if (state.online?.active ? (r.doneAt && now >= r.doneAt) : (r.doneHoldMs > 0 && (r.doneHoldMs -= delta * 1000) <= 0)) {
        restartGoalReplay();
        fn('draw')?.();
        return;
      }
      const post = r.played >= r.total;
      const speed = post ? 0.5 : ububallMatch.replaySpeed(r.total - r.played);
      let steppedReplay = false;
      fn('runPlaybackTicks')?.(r, delta, speed, 48, () => state.hitStopUntil || 0, () => {
        steppedReplay = true;
        fn('capturePose')?.(r.sim, r.seat);
        if (r.played < r.total) {
          if (r.tick >= r.segments[r.index].ticks) {
            nextReplaySegment();
            fn('clearPose')?.();
          }
          if (P.step(r.sim, P.DT, replayFx.hit, replayFx.wall, replayFx.shock, replayFx.super) !== null && P.ballOnFire(r.sim[6]) && state.fieldEffects?.netFire) {
            state.fieldEffects.netFire.lit = true;
          }
          r.tick++; r.played++;
          replayEvents(r.segments[r.index], r.tick, r.sim);
          syncReplayTick();
          fn('recordTrails')?.();
          if (r.played >= r.total) {
            r.doneAt = (getPerf()?.now?.() ?? 0) + ububallMatch.GOAL_REPLAY_HOLD;
            r.doneHoldMs = ububallMatch.GOAL_REPLAY_HOLD;
          }
        } else if (fn('stepPostGoalFrame')?.(r.sim, replayFx, syncReplayTick)) {
          fn('clearPose')?.();
          return 'reset';
        }
      });
      if (steppedReplay && state.goalReplay) syncReplay();
      if (state.goalReplay && state.goalReplay.sim) {
        fn('syncInterpolatedBodies')?.((fn('clockNow')?.() ?? 0) < (state.hitStopUntil || 0) ? 1 : state.goalReplay.steps, state.goalReplay.sim, state.goalReplay.seat);
      }
      fn('emitSkaterEffects')?.(delta * speed);
      fn('draw')?.();
    }

    return {
      replayEvents,
      replayHitStop,
      currentReplay,
      activeOnlineSim,
      shownSim,
      shownSeat,
      replayView,
      syncReplay,
      syncReplayTick,
      replayFx,
      restartGoalReplay,
      nextReplaySegment,
      startGoalReplay,
      advanceGoalReplay,
      endGoalReplay
    };
  }

  function createMatchLifecycleController(deps = {}) {
    const { state, fn, $, getDoc, getPerf } = makeLookup(deps);
    const getP = () => deps.P ?? state.P;
    const getUbu = () => deps.ubu ?? state.ubu;
    const getMatch = () => deps.ububallMatch ?? state.ububallMatch;
    const getReplayMod = () => deps.ububallReplay ?? state.ububallReplay;
    const getStorage = () => deps.localStorage ?? state.localStorage ?? root.localStorage;

    function recordSegment(source, turnPlans, ticks = 0, saves = [], stops = []) {
      const P = getP();
      if (P.settled(source)) state.playSegments = [];
      state.playSegments.push({ bodies: structuredClone(source), plans: structuredClone(turnPlans), ticks, saves, stops });
    }

    const saveEvent = (tick, s) => ({ tick, index: s.index, own: s.own, iron: Boolean(s.iron) });

    function noteEvents(tick, saves, stop) {
      for (const turn of [state.playSegments?.at(-1), state.recording?.turns?.at(-1)]) {
        if (!turn) continue;
        for (const s of saves) turn.saves.push(saveEvent(tick, s));
        if (stop) turn.stops.push({ tick, ms: stop });
      }
    }

    function libraryEntry(r, file, auto) {
      const P = getP(), ububallReplay = getReplayMod();
      const last = r.turns.at(-1);
      return {
        format: ububallReplay.FORMAT,
        physics: P.VERSION,
        recorded: r.recorded,
        mode: r.mode,
        seat: r.seat,
        title: r.title,
        clip: r.clip,
        names: r.names,
        scores: r.final?.scores || last.scores.map((n, team) => n + (last.goal?.team === team ? 1 : 0)),
        final: Boolean(r.final),
        turns: r.turns.length,
        auto,
        pinned: false,
        file
      };
    }

    function saveRecording() {
      const ububallReplay = getReplayMod();
      const r = state.recording;
      state.recording = null; state.recordingOnline = false;
      if (!r) return state.lastSaved;
      r.turns = r.turns.filter(t => t.ticks);
      if (!r.turns.length) return state.lastSaved;
      state.lastCompletedReplay = r;
      const store = deps.replayStore ?? state.replayStore;
      state.lastSaved = ububallReplay.write(r).then(file => store.add(libraryEntry(r, file, true)))
        .catch(error => { console.warn('Replay not saved.', error); return null; });
      return state.lastSaved;
    }

    function noteTurn(ticks, goal, cards) {
      const t = state.recording?.turns?.at(-1);
      if (t && !t.ticks) Object.assign(t, { ticks, goal, cards: [...cards] });
    }

    function makeGuide(sim, plans, seat, guideTurn, guideScores) {
      const start = fn('viewBodies')(sim, seat);
      return {
        turn: guideTurn,
        goals: guideScores[0] + guideScores[1],
        seat,
        ticks: 0,
        start,
        paths: start.map(b => [b.x, b.y]),
        moves: onlineOrder(plans, seat).map(p => ({ ...p, angle: p.angle + (seat ? Math.PI : 0) }))
      };
    }

    function beginGuide(sim, plans, seat) {
      state.guide = makeGuide(sim, plans, seat, state.turn, state.scores);
    }

    function traceGuide(sim, pathGuide = state.guide) {
      if (!pathGuide || ++pathGuide.ticks % 3) return;
      const { seat, paths } = pathGuide;
      sim.forEach((b, c) => paths[viewIndex(c, seat)].push(seat ? 1000 - b.x : b.x, seat ? 600 - b.y : b.y));
    }

    function guideShown(key, g) {
      if (!state.guides?.[key] || !g) return false;
      if (state.theater || state.activePlayback) return true;
      if (state.demo || state.goalReplay) return false;
      if (state.phase === 'play') return g.turn === state.turn;
      return key === 'trails' && g.turn === state.turn - 1 && g.goals === state.scores[0] + state.scores[1];
    }

    function clearActiveMatch() {
      fn('cancelScheduledSave')?.();
      try { getStorage()?.removeItem?.('ububall-active-match'); } catch {}
    }

    function saveActiveMatch(launchState = null) {
      const P = getP(), ububallMatch = getMatch(), ububallReplay = getReplayMod();
      fn('cancelScheduledSave')?.();
      if (state.inDiscord) return;
      if (state.demo || state.online?.active || state.phase === 'over' || !state.recording) {
        (fn('clearActiveMatch') ?? clearActiveMatch)();
        return;
      }
      try {
        const entryData = e => e ? {
          key: e.key,
          dna: e.dna,
          label: e.label,
          equippedSuper: e.equippedSuper ? { id: e.equippedSuper.id } : null
        } : null;
        const activeSim = launchState ? launchState.bodies : state.simBodies;
        const viewBodies = state.fieldView?.bodies || state.bodies || [];
        const data = {
          version: ububallMatch.VERSION,
          physics: P.VERSION,
          mode: state.fieldView?.mode ?? state.matchMode,
          level: state.cpuLevel,
          scores: [...state.scores],
          turn: state.turn,
          phase: launchState ? 'play' : state.phase,
          fouls: { crease: [...state.fouls.crease], corner: state.fouls.corner, cornerTurns: state.fouls.cornerTurns, cards: [...(state.fouls.cards || [])] },
          tally: state.tally,
          play: ububallMatch.newPlay(state.play),
          roundTurns: state.roundTurns,
          matchTicks: state.matchTicks,
          roster: state.roster.map(entryData),
          teamEntries: (state.fieldView?.entries || []).map(entryData),
          bodies: ububallReplay.snapshot(activeSim),
          turnPlans: launchState ? launchState.turnPlans : null,
          plans: launchState ? null : (Array.isArray(state.plans) ? state.plans.map((p, i) => ({ angle: p.angle, power: p.power, spin: p.spin || 0, superArm: Boolean(viewBodies[i]?.superArm || p.superArm), guard: Boolean(p.guard) })) : null),
          cpu: launchState ? null : (Array.isArray(state.cpu) ? state.cpu.map(p => ({ angle: p.angle, power: p.power, spin: p.spin || 0, superArm: Boolean(p.superArm), guard: Boolean(p.guard) })) : null),
          cpuDone: launchState ? false : Boolean(state.cpuDone),
          recording: state.recording || null
        };
        getStorage()?.setItem?.('ububall-active-match', JSON.stringify(data));
      } catch {}
    }

    function kickoff(isNewMatch = false) {
      const P = getP(), ububallMatch = getMatch();
      fn('clearEffects')?.();
      if (state.fieldEffects) {
        state.fieldEffects.kickoffGlow = 1;
        state.fieldEffects.netFire = null;
      }
      state.play = ububallMatch.newPlay();
      state.scoringPlayer = null;
      state.roundTurns = 0;
      state.fouls = ububallMatch.newFouls();
      if (isNewMatch) {
        state.matchTicks = 0;
        state.tally = ububallMatch.newTally();
        fn('closeSummary')?.();
        state.cpuMatchSeed = (Math.random() * 0x100000000) >>> 0;
      }
      const oldBodies = state.authoritativeBodies || state.simBodies;
      state.authoritativeBodies = null;
      const result = P.kickoff();
      const entries = state.fieldView?.entries || [];
      const mode = state.fieldView?.mode ?? state.matchMode;
      const classic = Boolean(fn('classicMode')?.());
      const resSuper = (e, i) => fn('resolveEquippedSuper') ? fn('resolveEquippedSuper')(e, i) : resolveEquippedSuper(P, e, i);
      result.slice(0, 6).forEach((b, i) => {
        ububallMatch.applyStats(P, b, state.stats[i], mode);
        const entry = entries[i];
        if (entry?.model) {
          b.personality = entry.model.personality;
          const sObj = entry.equippedSuper || resSuper(entry, i);
          b.equippedSuper = sObj ? { id: sObj.id, key: sObj.key, bonusTicks: sObj.bonusTicks || 0, bonusRefund: sObj.bonusRefund || 0 } : null;
          b.superBonusTicks = sObj?.bonusTicks || 0;
          b.superBonusRefund = sObj?.bonusRefund || 0;
          if (isNewMatch) {
            const rating = entry.model.rating ?? 511;
            b.meter = Math.min(100, Math.max(0, (rating / 1020) * 100));
            b.stunned = false;
          } else {
            b.meter = oldBodies?.[i]?.meter ?? 0;
            b.stunned = oldBodies?.[i]?.stunned || false;
          }
          if (classic) { b.meter = 0; b.equippedSuper = null; b.superBonusTicks = 0; b.superBonusRefund = 0; }
          b.superArm = false;
          b.superActive = null;
        }
      });
      state.simBodies = result;
      fn('syncViewBodies')?.(state.simBodies, 0);
      const viewBodies = state.fieldView?.bodies || state.bodies || [];
      viewBodies.slice(0, 6).forEach(b => { b.superArm = false; });
      return viewBodies;
    }

    function restoreActiveMatch() {
      const P = getP(), ubu = getUbu(), ububallMatch = getMatch(), ububallReplay = getReplayMod();
      const clearFn = fn('clearActiveMatch') ?? clearActiveMatch;
      try {
        const raw = getStorage()?.getItem?.('ububall-active-match');
        if (!raw) return false;
        const saved = JSON.parse(raw);
        if (!saved || saved.version !== ububallMatch.VERSION || saved.physics !== P.VERSION || !saved.bodies || !saved.roster || !saved.teamEntries) {
          clearFn();
          return false;
        }
        state.authoritativeBodies = null;
        fn('endGoalReplay')?.();
        state.playSegments = [];
        state.cpuMode = saved.mode || 'standard';
        const validCpuLevels = deps.VALID_CPU_LEVELS ?? state.VALID_CPU_LEVELS ?? ['easy', 'medium', 'hard', 'insane', 'god', 'ballistic'];
        state.cpuLevel = validCpuLevels.includes(saved.level) ? saved.level : 'medium';
        state.fieldView.mode = state.cpuMode;
        const doc = getDoc();
        const radio = doc?.querySelector?.(`input[name="cpu-level"][value="${state.cpuLevel}"]`);
        if (radio) radio.checked = true;
        doc?.body?.classList?.toggle?.('classic-match', Boolean(fn('classicMode')?.()));
        fn('showMode')?.(state.fieldView.mode);

        const resSuper = (e, i) => fn('resolveEquippedSuper') ? fn('resolveEquippedSuper')(e, i) : resolveEquippedSuper(P, e, i);
        const restoreFn = fn('restoreEntry') ?? (s => restoreEntry(P, ubu, s, (e, i) => resSuper(e, i)));
        state.roster = saved.roster.map(restoreFn);
        state.draft = [...state.roster];
        state.fieldView.entries = saved.teamEntries.map(restoreFn);
        const normalStats = fn('normalStats');
        const classic = Boolean(fn('classicMode')?.());
        state.stats = state.fieldView.entries.map(entry => classic ? normalStats() : { ...(entry?.model?.stats || normalStats()) });
        fn('stopFanfare')?.();
        fn('gameAudio')?.()?.stop?.();

        state.scores = [...saved.scores];
        state.turn = saved.turn;
        state.fouls = { ...ububallMatch.newFouls(), ...saved.fouls };
        state.tally = saved.tally || ububallMatch.newTally();
        state.recording = saved.recording || ububallReplay.create({
          mode: state.fieldView.mode,
          names: ['You', 'CPU'],
          ubus: state.fieldView.entries.map(e => ({ dna: e.dna, super: e.equippedSuper?.id ?? null }))
        });
        state.play = ububallMatch.newPlay(saved.play);
        state.matchTicks = saved.matchTicks ?? 0;
        state.roundTurns = saved.roundTurns ?? 0;
        if (saved.matchTicks == null || saved.roundTurns == null) {
          let ticks = 0, turns = 0;
          for (const entry of state.recording.turns) {
            if (!entry.ticks) continue;
            ticks += entry.ticks;
            turns = entry.goal ? 0 : turns + 1;
          }
          state.matchTicks = saved.matchTicks ?? ticks;
          state.roundTurns = saved.roundTurns ?? turns;
        }
        const restored = ububallReplay.restore(saved.bodies);
        if (saved.matchTicks == null) {
          for (const b of restored) if (b.meterTick > state.matchTicks) delete b.meterTick;
        }
        fn('buildTeam')?.();
        restored.slice(0, 6).forEach((b, i) => {
          const entry = state.fieldView.entries[i];
          if (entry?.model) {
            b.personality = entry.model.personality;
            const sObj = classic ? null : (entry.equippedSuper || b.equippedSuper || resSuper(entry, i));
            b.equippedSuper = sObj ? { id: sObj.id, key: sObj.key, bonusTicks: sObj.bonusTicks || 0, bonusRefund: sObj.bonusRefund || 0 } : null;
            b.superBonusTicks = sObj?.bonusTicks || 0;
            b.superBonusRefund = sObj?.bonusRefund || 0;
          }
        });
        state.simBodies = stripPresentation(restored);
        fn('syncViewBodies')?.(state.simBodies, 0);
        state.selected = 0;
        state.drag = null;

        if (saved.phase === 'play' && Array.isArray(saved.turnPlans) && saved.turnPlans.length === 6) {
          state.plans = saved.turnPlans.slice(0, 3);
          (fn('recordSegment') ?? recordSegment)(state.simBodies, saved.turnPlans);
          (fn('beginGuide') ?? beginGuide)(state.simBodies, saved.turnPlans, 0);
          const liveFx = deps.liveFx ?? state.liveFx;
          P.startTurn(state.simBodies, saved.turnPlans, liveFx?.super ?? fn('handleSuper'));
          fn('syncViewBodies')?.(state.simBodies, 0);
          state.elapsed = state.accumulator = 0;
          state.phase = 'play';
          fn('say')?.('Turn in motion…');
        } else {
          state.phase = 'plan';
          fn('dirtyPrediction')?.();
          if (Array.isArray(saved.plans) && saved.plans.length === 3) {
            state.plans = saved.plans;
          } else {
            state.plans = Array.from({ length: 3 }, () => fn('idlePlan')());
          }
          fn('startPlanClock')?.();
          if (saved.cpuDone && Array.isArray(saved.cpu) && saved.cpu.length === 3) {
            state.cpu = saved.cpu;
            state.cpuDone = true;
            state.cpuReady = Promise.resolve();
          } else {
            fn('prepareCPU')?.(Array.isArray(saved.cpu) && saved.cpu.length === 3 ? saved.cpu : null);
          }
          fn('say')?.('Plan your next three launches.');
        }
        fn('sync')?.();
        fn('draw')?.();
        return true;
      } catch {
        clearFn();
        return false;
      }
    }

    function newMatch(playJingle = false, team = state.draft, { standby = false } = {}) {
      const ububallReplay = getReplayMod();
      fn('clearReplayViewer')?.();
      state.authoritativeBodies = null;
      fn('endGoalReplay')?.();
      state.playSegments = [];
      (fn('saveRecording') ?? saveRecording)();
      state.fieldView.mode = state.cpuMode;
      const doc = getDoc();
      doc?.body?.classList?.toggle?.('classic-match', Boolean(fn('classicMode')?.()));
      fn('showMode')?.(state.fieldView.mode);
      state.cpuTeam = fn('starterEntries')('cpu', 'CPU ubu');
      const classic = Boolean(fn('classicMode')?.());
      const normalStats = fn('normalStats');
      state.stats = [...team, ...state.cpuTeam].map(entry => classic ? normalStats() : { ...(entry.model.stats || normalStats()) });
      fn('stopFanfare')?.();
      fn('gameAudio')?.()?.stop?.();
      state.roster = [...team];
      state.fieldView.entries = [...state.roster, ...state.cpuTeam];
      state.fieldView.bodies = kickoff(true);
      fn('buildTeam')?.();
      state.scores = [0, 0]; state.turn = 1; state.selected = 0; state.phase = 'plan'; state.elapsed = state.accumulator = 0; state.drag = null;
      const active = !state.demo && !standby;
      if (active) {
        state.recording = ububallReplay.create({
          mode: state.fieldView.mode,
          names: ['You', 'CPU'],
          ubus: state.fieldView.bodies.slice(0, 6).map((b, i) => ({ dna: state.fieldView.entries[i].dna, super: b.equippedSuper?.id ?? null }))
        });
      }
      if (standby) {
        fn('dirtyPrediction')?.();
        state.plans = Array.from({ length: 3 }, () => fn('idlePlan')());
        fn('sync')?.();
      } else {
        fn('resetPlans')?.();
      }
      if (active) (fn('saveActiveMatch') ?? saveActiveMatch)();
      fn('say')?.('Drag from an ubu toward your target to aim. Drag its arrowhead to adjust power and direction.');
      fn('draw')?.();
      if (playJingle) fn('gameAudio')?.()?.playGameStart?.();
    }

    function finishTurn(goal) {
      const P = getP(), ububallMatch = getMatch();
      const ticks = Math.round(state.elapsed / P.DT);
      if (state.playSegments?.length) state.playSegments[state.playSegments.length - 1].ticks = ticks;
      const ace = goal !== null && !state.roundTurns;
      const call = goal === null ? null : ububallMatch.callGoal(state.simBodies, state.play, state.tally, goal, ace);
      if (goal !== null && fn('ballOnFire')?.()) fn('lightNet')?.(goal); else fn('quench')?.();
      const before = fn('trailPositions')?.() || [];
      ububallMatch.finishTurn(
        P, state.simBodies, state.stats, state.scores, goal, state.fieldView?.mode ?? state.matchMode,
        { ace: ace && !call.own ? call.scorer : null, assist: call?.assist ?? null, keepMotion: goal !== null },
        state.fouls, state.tally
      );
      fn('syncViewBodies')?.(state.simBodies, 0);
      fn('clearDiscontinuousTrails')?.(before);
      if (state.fouls.faceoff) state.play = ububallMatch.newPlay();
      (fn('noteTurn') ?? noteTurn)(ticks, goal === null ? null : { team: goal, label: call.label, scorer: call.own ? null : call.scorer, assist: call.assist }, state.fouls.cards);
      fn('announceFouls')?.();
      if (goal !== null) ububallMatch.noteScore(state.tally, state.scores);
      state.roundTurns++;
      state.matchTicks += ticks;
      const viewBodies = state.fieldView?.bodies || state.bodies || [];
      viewBodies.slice(0, 6).forEach(b => state.dirtyMeters?.add(b));
      state.accumulator = 0; state.layoutDirty = true;
      if (goal !== null) {
        const celebSim = structuredClone(state.simBodies);
        P.stop(state.simBodies);
        state.authoritativeBodies = structuredClone(state.simBodies);
        state.phase = state.scores[goal] >= 5 ? 'over' : 'goal';
        fn('celebrate')?.(goal, viewBodies[6], call.label, call.own ? null : viewBodies[call.scorer] || null);
        if (call.assist !== null) fn('popup')?.(viewBodies[call.assist], 'Assist');
        if (state.phase === 'over') {
          if (state.recording) {
            state.recording.final = { scores: [...state.scores], winner: goal };
            (fn('saveRecording') ?? saveRecording)();
          }
          (fn('clearActiveMatch') ?? clearActiveMatch)();
        }
        const scorer = viewBodies[call.scorer] || viewBodies.slice(goal * 3, goal * 3 + 3)[0];
        const perfNow = getPerf()?.now?.() ?? 0;
        state.goalReplayAt = perfNow + ububallMatch.GOAL_REPLAY_DELAY + 800;
        state.goalReplayDelayMs = ububallMatch.GOAL_REPLAY_DELAY + 800;
        state.postGoal = { ticks: 0, sim: celebSim, seat: 0 };
        state.scoringPlayer = scorer;
        const scorerName = scorer?.name || (goal === 0 ? 'Your ubu' : 'CPU ubu');
        fn('goalTab')?.(goal, call.label, call.own ? null : scorerName);
        const callText = fn('callText')?.(call.label, scorerName) || '';
        const honourText = fn('honourText')?.(goal) || '';
        fn('say')?.(state.phase === 'over'
          ? `${goal === 0 ? 'You win!' : 'CPU wins.'} ${callText}${honourText} Tap the replay for results.`
          : `${goal === 0 ? 'You score!' : 'CPU scores.'} ${callText} Ready for the next kickoff.`
        );
        fn('loopFanfare')?.(scorer?.voice);
        fn('sync')?.();
        if (state.phase === 'goal') {
          const launchEl = $('launch'), launchLabel = $('launch-label');
          if (launchEl) launchEl.disabled = false;
          if (launchLabel) launchLabel.textContent = 'Next kickoff';
        }
      } else {
        state.turn++; state.phase = 'plan'; fn('resetPlans')?.(true);
        (fn('saveActiveMatch') ?? saveActiveMatch)();
        const ft = fn('foulText')?.();
        fn('say')?.(ft || (fn('pulseMode')?.() && !P.settled(state.simBodies) ? 'Pulse paused. Adjust your launches or guard to brake.' : 'Field settled. Plan your next three launches.'));
      }
      fn('draw')?.();
    }

    function onGuestTeam() {
      return Boolean(state.roster?.length > 0 && state.roster.every(entry => Boolean(entry?.key?.startsWith('guest-'))));
    }

    return {
      recordSegment,
      saveEvent,
      noteEvents,
      libraryEntry,
      saveRecording,
      noteTurn,
      makeGuide,
      beginGuide,
      traceGuide,
      guideShown,
      clearActiveMatch,
      saveActiveMatch,
      kickoff,
      restoreActiveMatch,
      newMatch,
      finishTurn,
      onGuestTeam
    };
  }

  function createOnlineMatchController(deps = {}) {
    const { state, fn, $, getDoc, getWin, getPerf } = makeLookup(deps);
    const getP = () => deps.P ?? state.P;
    const getUbu = () => deps.ubu ?? state.ubu;
    const getMatch = () => deps.ububallMatch ?? state.ububallMatch;
    const getReplayMod = () => deps.ububallReplay ?? state.ububallReplay;
    const getGameUi = () => deps.gameUi ?? state.gameUi;
    const fallbackPostGoalState = { steps: 0, onTick: null };

    function networkMoves() {
      const viewBodies = state.fieldView?.bodies || state.bodies || [];
      return state.plans.map((p, i) => ({
        angle: p.angle + (state.online?.state?.seat ? Math.PI : 0),
        power: p.power,
        spin: p.spin || 0,
        superArm: Boolean(viewBodies[i].superArm),
        guard: Boolean(p.guard)
      }));
    }

    function onlineNames(s) {
      if (s.spectator) return s.names.map((name, i) => name || 'Player ' + (i + 1));
      return [s.names[s.seat] || 'Guest', s.occupied[1 - s.seat] ? s.names[1 - s.seat] || 'Guest' : 'Opponent'];
    }

    function updateRematch(s) {
      if (s.spectator) {
        const r1 = $('online-rematch'), r2 = $('summary-rematch');
        if (r1) r1.hidden = true;
        if (r2) r2.hidden = true;
        const st = $('summary-rematch-status');
        if (st) st.textContent = '';
        return;
      }
      const them = onlineNames(s)[1], mine = s.rematch[s.seat], theirs = s.rematch[1 - s.seat];
      for (const button of [$('online-rematch'), $('summary-rematch')]) {
        if (!button) continue;
        button.hidden = s.phase !== 'over' || s.left.some(Boolean);
        button.disabled = mine;
        button.textContent = mine ? 'Rematch requested' : theirs ? 'Accept rematch' : 'Rematch';
      }
      const note = $('summary-rematch-status');
      if (note) {
        note.textContent = s.phase !== 'over' ? '' : s.left[1 - s.seat] ? `${them} left the match.` :
          mine && !s.connected[1 - s.seat] ? `${them} is offline. They can accept when they return.` :
            mine ? `Waiting for ${them} to accept.` : theirs ? `${them} wants a rematch.` : '';
      }
    }

    function recordOnline(s) {
      const ububallMatch = getMatch(), ububallReplay = getReplayMod();
      if (s.phase === 'plan') state.onlinePlanFouls = structuredClone(s.game.fouls);
      if (state.recordingOnline || s.phase === 'over') return;
      fn('saveRecording')?.();
      state.lastCompletedReplay = null;
      const [me, them] = onlineNames(s), classic = ububallMatch.rule(s.mode, 'classic');
      state.recording = ububallReplay.create({
        mode: s.mode,
        seat: s.seat,
        names: s.seat ? [them, me] : [me, them],
        ubus: s.rosters.flat().map(entry => ({ dna: entry.dna, super: classic ? null : entry.superId }))
      });
      state.recordingOnline = true;
    }

    function recordOnlineTurn(s) {
      const ububallMatch = getMatch(), ububallReplay = getReplayMod();
      if (!state.recordingOnline) return;
      const r = s.replay, sc = s.game.scores.map((n, team) => team === r.goal ? n - 1 : n);
      const t = ububallReplay.addTurn(state.recording, {
        turn: r.turn,
        scores: sc,
        fouls: state.onlinePlanFouls || ububallMatch.newFouls(),
        bodies: r.initialBodies,
        plans: r.plans
      });
      const sv = fn('saveEvent') ?? ((tick, e) => ({ tick, index: e.index, own: e.own, iron: Boolean(e.iron) }));
      Object.assign(t, {
        ticks: r.ticks,
        cards: [...(s.game.fouls?.cards || [])],
        saves: r.saves.map(e => sv(e.tick, e)),
        stops: structuredClone(r.stops),
        goal: r.goal === null ? null : { team: r.goal, label: r.label, scorer: r.label === 'OWN GOAL' ? null : r.scorer, assist: r.assist }
      });
    }

    function finishOnlineRecording(s) {
      if (!state.recordingOnline || s.phase !== 'over') return;
      if (s.game.winner != null) state.recording.final = { scores: [...s.game.scores], winner: s.game.winner };
      fn('saveRecording')?.();
    }

    function playOnlineReplay() {
      const ububallMatch = getMatch();
      const replay = state.onlineReplay;
      if (!replay || !replay.simBodies || !state.online?.state) return;
      const seat = state.online.state.seat;
      const syncSim = () => fn('syncViewBodies')?.(replay.simBodies, seat);
      const syncTickFn = fn('syncTickBodies');
      const syncTick = () => (typeof syncTickFn === 'function' ? syncTickFn(replay.simBodies, seat) : syncSim());
      const capPose = fn('capturePose');
      const syncInterp = fn('syncInterpolatedBodies');
      const pgState = deps.postGoalState ?? state.postGoalState ?? fallbackPostGoalState;
      const replayFx = deps.replayFx ?? state.replayFx;
      const res = fn('stepOnlineTurn')({
        replay,
        nowMs: state.online.now(),
        seat,
        fouls: state.fouls,
        fx: replayFx,
        syncSim,
        syncTick,
        onBeforeStep: typeof capPose === 'function' ? () => capPose(replay.simBodies, seat) : null,
        syncInterpolated: typeof syncInterp === 'function'
          ? alpha => syncInterp((fn('clockNow')?.() ?? 0) < (state.hitStopUntil || 0) ? 1 : alpha, replay.simBodies, seat)
          : null,
        toView: b => fn('toViewBody')(b, replay.simBodies, seat),
        onGoalReached: () => {
          const perfNow = getPerf()?.now?.() ?? 0;
          state.goalReplayAt = perfNow + ububallMatch.GOAL_REPLAY_DELAY;
          const celebSim = structuredClone(replay.simBodies);
          replay.postGoalSim = celebSim;
          state.postGoal = { ticks: 0, sim: celebSim, seat };
          pgState.steps = 0;
          fn('syncViewBodies')?.(celebSim, seat);
          const viewBodies = state.fieldView?.bodies || state.bodies || [];
          const viewGoal = replay.goal === seat ? 0 : 1;
          const toViewIdx = index => index == null ? null : viewIndex(index, seat);
          fn('celebrate')?.(viewGoal, viewBodies[6], replay.label || 'GOAL', replay.label === 'OWN GOAL' ? null : viewBodies[toViewIdx(replay.scorer)] || null);
          if (fn('ballOnFire')?.()) fn('lightNet')?.(viewGoal);
          if (toViewIdx(replay.assist) !== null) fn('popup')?.(viewBodies[toViewIdx(replay.assist)], 'Assist');
          const viewScorerIndex = toViewIdx(replay.scorer);
          const scorer = viewScorerIndex !== null ? viewBodies[viewScorerIndex] : viewBodies[viewGoal * 3];
          state.scoringPlayer = scorer;
          const [home, them] = onlineNames(state.online.state), scoringTeam = viewGoal === 0 ? home : them;
          const scorerName = scorer?.name || (state.online.spectating ? `${scoringTeam}'s ubu` : viewGoal === 0 ? 'Your ubu' : `${them}'s ubu`);
          fn('goalTab')?.(viewGoal, replay.label || 'GOAL', replay.label === 'OWN GOAL' ? null : scorerName);
          const callTxt = fn('callText')?.(replay.label || 'GOAL', scorerName) || '';
          const honourTxt = fn('honourText')?.(0) || '';
          const honourAway = fn('honourText')?.(1) || '';
          fn('say')?.(state.online.spectating
            ? `${scoringTeam} ${state.online.state.game.winner !== null ? 'wins' : 'scores'}. ${callTxt}`
            : state.online.state.game.winner !== null
              ? (viewGoal === 0 ? `You win! ${callTxt}${honourTxt}` : `${them} wins. ${callTxt}${honourAway}`)
              : `${viewGoal === 0 ? 'You score!' : `${them} scores.`} ${callTxt} Ready for the next kickoff.`
          );
          fn('loopFanfare')?.(scorer?.voice);
          fn('sync')?.();
        },
        onSettledTurnEnd: () => {
          if (replay.goal === null && !replay.settledSynced) {
            const before = fn('trailPositions')?.() || [];
            fn('syncViewBodies')?.(state.online.state.game.bodies, seat);
            fn('clearDiscontinuousTrails')?.(before);
            replay.settledSynced = true;
          } else if (replay.goal !== null) {
            replay.settledSynced = true;
          }
          if (!replay.fouled) {
            replay.fouled = true;
            const vfFn = fn('viewFouls') ?? ((f, st) => viewFouls(ububallMatch, f, st));
            state.fouls = vfFn(state.online.state.game.fouls, seat);
            fn('announceFouls')?.();
            const ft = fn('foulText')?.();
            if (replay.goal === null && ft) fn('say')?.(ft);
          }
        }
      });
      if (!replay.fouled) state.fouls = res.fouls;
      if (replay.goal !== null) {
        const preScores = seat ? [...state.online.state.game.scores].reverse() : [...state.online.state.game.scores];
        const viewGoal = replay.goal === seat ? 0 : 1;
        if (replay.currentTick < replay.ticks) preScores[viewGoal]--;
        state.scores = preScores;
      } else {
        state.scores = seat ? [...state.online.state.game.scores].reverse() : [...state.online.state.game.scores];
      }
    }

    const callbacks = {
      async playCpu() {
        if (await fn('ownTeamReady')?.()) fn('startCpuMatch')?.(state.roster, 'standard', 'easy');
      },
      cpuActive() { return Boolean(state.inDiscord && fn('matchInProgress')?.()); },
      resumeCpu() { fn('enterMatch')?.(); $('pause-menu')?.close?.(); },
      prepareOnline() {
        const sheetOpenFn = fn('sheetOpen');
        fn('clearReplayViewer')?.();
        if (!state.online?.active && fn('matchInProgress')?.()) fn('finishCpuMatch')?.();
        if (sheetOpenFn?.() && state.setupFor !== 'lobby') {
          if (fn('isSetupShot')?.()) state.handoffToMatch = true;
          fn('closeSheet')?.();
          state.lineupMove?.cancel?.(); state.lineupMove = null; $('roster-slots')?.replaceChildren?.();
        }
        fn('stopDemo')?.();
        state.cpuClient?.cancel?.(); state.cpuClient?.dispose?.();
        state.demoClient?.dispose?.();
        fn('closeFirstTurnGuide')?.();
        fn('closeFoulInfo')?.();
        $('pause-menu')?.close?.(); fn('closeSummary')?.();
      },
      chooseMode(mode) { fn('openSetup')?.('mode', 'online', mode); },
      editRules(mode) { fn('openSetup')?.('mode', 'rules', mode); },
      onNewGame() {
        fn('saveRecording')?.();
        state.onlineRoster = ''; state.onlineTurn = 0; state.onlineReplay = null;
        state.postGoal = null; state.onlinePhase = ''; state.onlinePlanFouls = null;
        fn('closeSummary')?.(); fn('endGoalReplay')?.(); fn('stopFanfare')?.();
      },
      lobby(view, open) { void fn('showLobby')?.(view, open); },
      closeLobby(...args) { return fn('closeLobby')?.(...args); },
      onState(s) {
        const P = getP(), ubu = getUbu(), ububallMatch = getMatch();
        const doc = getDoc();
        fn('clearReplayViewer')?.();
        if (!doc?.body?.classList?.contains?.('online-match')) {
          fn('stopDemo')?.(); fn('endGoalReplay')?.(); fn('stopFanfare')?.();
        }
        doc?.body?.classList?.add?.('online-match');
        const isSheetOpen = typeof fn('sheetOpen') === 'function' ? fn('sheetOpen')() : $('roster-dialog')?.classList?.contains?.('open');
        if (state.setupFor === 'rules' && (!s.canChangeRules || s.phase !== 'plan') && isSheetOpen) {
          if (typeof fn('closeSheet') === 'function') fn('closeSheet')();
          else $('roster-dialog')?.classList?.remove?.('open');
        }
        if (s.game && s.phase !== 'lobby') fn('enterMatch')?.('match');
        const openLbl = $('online-open-label'), openNote = $('online-open-note');
        if (openLbl) openLbl.textContent = s.spectator ? 'Watching a match' : 'Online match';
        if (openNote) openNote.hidden = true;
        const [me, them] = onlineNames(s);
        $('home-label').textContent = me;
        $('opponent-label').textContent = them;
        $('opponent-heading').textContent = `${them}'s team`;
        $('new-match').disabled = true;
        state.fieldView.mode = s.mode;
        doc?.body?.classList?.toggle?.('classic-match', Boolean(fn('classicMode')?.()));
        fn('showMode')?.(s.mode);
        updateRematch(s);
        if (state.onlinePhase === 'over' && s.phase !== 'over') fn('closeSummary')?.();
        if (!s.game) { state.phase = 'waiting'; state.onlineReplay = null; fn('sync')?.(); fn('draw')?.(); return; }
        const rosterKey = JSON.stringify(s.rosters);
        const ubuListObj = deps.ubuList ?? state.ubuList ?? root.ubuList;
        if (rosterKey !== state.onlineRoster) {
          state.onlineRoster = rosterKey;
          state.fieldView.entries = onlineOrder(s.rosters.flat(), s.seat).map((entry, idx) => {
            const model = ubu.decode(ubu.fromCode(entry.dna));
            const mastery = P.superMastery(model.supers, entry.superId);
            const serial = entry.serial || null;
            return {
              key: serial || `online-${idx}`,
              label: serial && ubuListObj?.serialLabel ? ubuListObj.serialLabel(serial) : 'Online ubu',
              model,
              dna: entry.dna,
              equippedSuper: { ...P.SUPERS[entry.superId], ...mastery }
            };
          });
          fn('buildTeam')?.();
        }
        if (!s.spectator) recordOnline(s);
        const fresh = state.onlineTurn !== s.turn || state.onlineDisconnected || (s.phase === 'plan' && state.onlinePhase !== 'plan');
        const justFinished = s.phase === 'over' && state.onlinePhase !== 'over' && s.winner !== null;
        state.onlinePhase = s.phase;
        state.onlineDisconnected = false;
        const viewBodies = state.fieldView?.bodies || state.bodies || [];
        const armed = viewBodies.slice(0, 3).map(b => Boolean(b.superArm));
        if (s.spectator || fresh || !s.connected.every(Boolean) || s.locked[s.seat]) state.drag = null;
        if (fresh) {
          fn('dirtyPrediction')?.();
          state.onlineTurn = s.turn; state.scoringPlayer = null; fn('clearEffects')?.();
          const ball = s.game.bodies[6];
          if (s.phase === 'plan' && ball.x === 500 && ball.y === 300 && state.fieldEffects) state.fieldEffects.kickoffGlow = 1;
        }
        if (s.phase !== 'resolving' || fresh || (state.onlineReplay && state.onlineReplay.turn !== s.replay?.turn)) {
          state.postGoal = null; fn('endGoalReplay')?.(); fn('stopFanfare')?.();
        }
        const before = !fresh && !s.replay && !state.goalReplay && !state.postGoal ? (fn('trailPositions')?.() || null) : null;
        if (!state.goalReplay && !state.postGoal && !(state.onlineReplay && state.onlineReplay.postGoalSim)) {
          fn('syncViewBodies')?.(s.game.bodies, s.seat);
        }
        if (before) fn('clearDiscontinuousTrails')?.(before);
        if (!s.replay) {
          const vfFn = fn('viewFouls') ?? ((f, st) => viewFouls(ububallMatch, f, st));
          state.fouls = vfFn(s.game.fouls, s.seat);
        }
        state.stats = onlineOrder(s.game.stats, s.seat);
        const goalAlreadyShown = Boolean(state.onlineReplay && state.onlineReplay.turn === s.replay?.turn && state.onlineReplay.goalPlayed);
        const rawScores = (s.phase === 'resolving' && s.replay?.goal !== null && !goalAlreadyShown)
          ? s.game.scores.map((sc, gi) => gi === s.replay.goal ? sc - 1 : sc)
          : s.game.scores;
        state.scores = s.seat ? [...rawScores].reverse() : [...rawScores];
        state.turn = s.turn;
        const idlePlanFn = fn('idlePlan') ?? (() => ({ angle: 0, power: 0, spin: 0, guard: false }));
        if (s.spectator) state.plans = Array.from({ length: 3 }, idlePlanFn);
        else if (fresh) {
          state.plans = s.moves.map(p => ({
            ...p,
            angle: p.power === 0 ? 0 : (((p.angle + (s.seat ? Math.PI : 0)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
          }));
        }
        if (!s.spectator) state.plans.forEach((p, i) => { viewBodies[i].superArm = fresh ? s.moves[i].superArm : armed[i]; });
        if (!s.replay) {
          state.onlineReplay = null;
        } else if (state.onlineReplay?.turn !== s.replay.turn) {
          state.onlineReplay = s.replay;
          state.onlineReplay.currentTick = 0;
          state.onlineReplay.simBodies = stripPresentation(structuredClone(s.replay.initialBodies));
          const classic = Boolean(fn('classicMode')?.());
          const simEntries = Array.isArray(state.fieldView.entries) && state.fieldView.entries.length >= 6
            ? onlineOrder(state.fieldView.entries, s.seat)
            : null;
          state.onlineReplay.simBodies.forEach((b, i) => {
            if (i < 6) {
              const cached = simEntries?.[i];
              if (cached) {
                const mastery = classic ? null : (cached.equippedSuper?.bonusTicks !== undefined ? cached.equippedSuper : P.superMastery(cached.model?.supers, cached.equippedSuper?.id));
                b.equippedSuper = classic || !cached.equippedSuper ? null : {
                  id: cached.equippedSuper.id,
                  key: cached.equippedSuper.key || P.SUPERS[cached.equippedSuper.id]?.key,
                  bonusTicks: mastery?.bonusTicks || 0,
                  bonusRefund: mastery?.bonusRefund || 0
                };
                b.superBonusTicks = mastery?.bonusTicks || 0;
                b.superBonusRefund = mastery?.bonusRefund || 0;
              } else {
                const entry = (i < 3 ? s.rosters[0]?.[i] : s.rosters[1]?.[i - 3]);
                if (entry) {
                  const model = ubu.decode(ubu.fromCode(entry.dna));
                  const mastery = classic ? null : P.superMastery(model.supers, entry.superId);
                  b.equippedSuper = classic ? null : { id: entry.superId, key: P.SUPERS[entry.superId]?.key, bonusTicks: mastery?.bonusTicks || 0, bonusRefund: mastery?.bonusRefund || 0 };
                  b.superBonusTicks = mastery?.bonusTicks || 0;
                  b.superBonusRefund = mastery?.bonusRefund || 0;
                }
              }
            }
          });
          const sv = fn('saveEvent') ?? ((tick, e) => ({ tick, index: e.index, own: e.own, iron: Boolean(e.iron) }));
          fn('recordSegment')?.(state.onlineReplay.simBodies, state.onlineReplay.plans, s.replay.ticks, s.replay.saves.map(e => sv(e.tick, e)), structuredClone(s.replay.stops));
          if (!s.spectator) recordOnlineTurn(s);
          fn('beginGuide')?.(state.onlineReplay.simBodies, state.onlineReplay.plans, s.seat);
          const rfx = deps.replayFx ?? state.replayFx;
          P.startTurn(state.onlineReplay.simBodies, state.onlineReplay.plans, rfx?.super);
          fn('syncViewBodies')?.(state.onlineReplay.simBodies, s.seat);
        }
        if (!s.spectator) finishOnlineRecording(s);
        state.phase = s.phase === 'over' ? 'over' : s.phase === 'resolving' ? 'play' : !s.spectator && s.connected.every(Boolean) && !s.locked[s.seat] ? 'plan' : 'waiting';
        fn('sync')?.();
        if (state.onlineReplay && !state.goalReplay && (state.onlineReplay.currentTick ?? 0) < state.onlineReplay.ticks) playOnlineReplay();
        fn('draw')?.();
        if (justFinished) fn('openSummary')?.();
      },
      onDisconnect(reconnecting) {
        state.onlineDisconnected = reconnecting; state.phase = 'waiting'; state.drag = null;
        fn('sync')?.(); fn('draw')?.();
      },
      onError(message) { fn('say')?.(message); fn('banner')?.(message, 3000); },
      onOutdated() {
        const doc = getDoc();
        fn('stopDemo')?.();
        state.phase = 'waiting'; state.drag = null; state.postGoal = null;
        fn('endGoalReplay')?.(); fn('stopFanfare')?.(); fn('gameAudio')?.()?.stop?.();
        fn('closeLobby')?.(); fn('closeSummary')?.();
        fn('closeFoulInfo')?.();
        if (typeof fn('sheetOpen') === 'function' && fn('sheetOpen')() && typeof fn('closeSheet') === 'function') fn('closeSheet')();
        for (const dlg of doc?.querySelectorAll?.('dialog[open]') || []) {
          if (dlg.dataset.blocking !== 'true') dlg.close();
        }
        for (const pop of doc?.querySelectorAll?.('[popover]:popover-open') || []) {
          try { pop.hidePopover(); } catch {}
        }
        fn('sync')?.(); fn('draw')?.();
        getGameUi()?.blocking?.({
          title: 'Game updated',
          message: 'Ububall has updated. Refresh the page to continue playing.',
          confirmLabel: 'Refresh'
        });
      },
      onLeave() {
        const doc = getDoc(), win = getWin();
        const ubuListObj = deps.ubuList ?? state.ubuList ?? root.ubuList;
        fn('saveRecording')?.();
        state.onlineRoster = ''; state.onlineTurn = 0; state.onlineReplay = null;
        state.postGoal = null; state.onlinePhase = ''; state.scoringPlayer = null; state.onlinePlanFouls = null;
        doc?.body?.classList?.remove?.('online-match');
        $('online-open-label').textContent = 'Play online';
        $('online-open-note').hidden = false;
        $('new-match').disabled = false; $('online-forfeit').hidden = true;
        $('online-rematch').hidden = true; $('launch').hidden = false; fn('closeSummary')?.();
        $('online-change-rules').hidden = true;
        fn('stopDemo')?.();
        state.phase = 'over'; state.drag = null;
        fn('endGoalReplay')?.(); fn('stopFanfare')?.(); fn('gameAudio')?.()?.stop?.();
        if (!state.roster.length || state.roster.some(entry => !entry?.model || (!entry.key?.startsWith('guest-') && !ubuListObj?.get?.(entry.key)?.model))) {
          state.roster = [...(state.guestTeam || [])];
        }
        state.draft = [...state.roster];
        fn('exitMatchMode')?.();
        fn('startDemo')?.();
        void win?.ubuStarter?.refresh?.().catch(() => {});
        void fn('adoptAccountTeam')?.().catch(() => {});
      }
    };

    return {
      networkMoves,
      playOnlineReplay,
      onlineNames,
      updateRematch,
      recordOnline,
      recordOnlineTurn,
      finishOnlineRecording,
      callbacks
    };
  }

  function createStageController(deps = {}) {
    const raw = deps.state ?? deps.session ?? deps;
    const isTestRaw = Boolean(raw && typeof raw === 'object' && !raw.__isMatchSession);
    const PREFER_RAW = [
      'ownsFullscreen', 'exitOwnedFullscreen', 'setPortrait', 'fitSetupShot', 'stagePoint',
      'foulInfoLines', 'closeFoulInfo', 'endCanvasDrag', 'point', 'wheelKnob', 'aimPower',
      'fieldTarget', 'finishCpuMatch'
    ];
    const rawOverrides = {};
    if (isTestRaw) {
      for (const key of PREFER_RAW) {
        if (typeof raw[key] === 'function') rawOverrides[key] = raw[key].bind(raw);
      }
    }

    const { state, fn, $, getDoc, getWin, getPerf, getRaf } = makeLookup(deps);
    const getP = () => deps.P ?? state.P;
    const getMatch = () => deps.ububallMatch ?? state.ububallMatch;
    const getUbu = () => deps.ubu ?? state.ubu;
    const getGameUi = () => deps.gameUi ?? state.gameUi;
    const getReducedMotion = () => deps.reducedMotion ?? state.reducedMotion ?? { matches: false };
    const getLoc = () => deps.location ?? state.location ?? getWin()?.location ?? root.location;
    const getHistory = () => deps.history ?? state.history ?? getWin()?.history ?? root.history;
    const getMatchMedia = () => deps.matchMedia ?? state.matchMedia ?? getWin()?.matchMedia?.bind?.(getWin()) ?? root.matchMedia;
    const getStorage = () => deps.localStorage ?? state.localStorage ?? getWin()?.localStorage ?? root.localStorage;
    const getScrollTo = () => deps.scrollTo ?? state.scrollTo ?? getWin()?.scrollTo?.bind?.(getWin()) ?? root.scrollTo;
    const getScrollY = () => (deps.scrollY !== undefined ? deps.scrollY : state.scrollY !== undefined ? state.scrollY : (getWin()?.scrollY ?? root.scrollY ?? 0));
    const getCancelRaf = () => deps.cancelAnimationFrame ?? state.cancelAnimationFrame ?? getWin()?.cancelAnimationFrame?.bind?.(getWin()) ?? root.cancelAnimationFrame;
    const getCustomEvent = () => deps.CustomEvent ?? state.CustomEvent ?? getWin()?.CustomEvent ?? root.CustomEvent;
    const getURL = () => deps.URL ?? state.URL ?? getWin()?.URL ?? root.URL;
    const getStageArea = () => deps.stageArea ?? state.stageArea ?? getDoc()?.querySelector?.('.stadium-stage-area');
    const getStadium = () => deps.stadium ?? state.stadium ?? $('stadium');
    const getRinkStage = () => deps.rinkStage ?? state.rinkStage ?? $('rink-stage');
    const getRinkWrap = () => deps.rinkWrap ?? state.rinkWrap ?? $('rink-wrap');
    const getBtnFullscreen = () => deps.btnFullscreen ?? state.btnFullscreen ?? $('btn-fullscreen');
    const getBtnRotate = () => deps.btnRotate ?? state.btnRotate ?? $('btn-rotate');
    const getStatDrawer = () => deps.statDrawer ?? state.statDrawer;
    const getAddEvt = () => deps.addEventListener ?? state.addEventListener ?? getWin()?.addEventListener?.bind?.(getWin());

    const doc = getDoc();
    const loc = getLoc();
    const homeShot = state.inDiscord ? 'lobby' : 'home';
    if (!('shot' in raw)) {
      state.shot = loc?.pathname === '/mint' ? 'mint' : loc?.pathname === '/collection' ? 'collection' : homeShot;
    }
    if (!('returnShot' in raw)) state.returnShot = homeShot;
    if (!('returnPortrait' in raw)) state.returnPortrait = false;
    if (!('handoffToMatch' in raw)) state.handoffToMatch = false;
    if (doc?.body?.dataset) doc.body.dataset.shot = state.shot;

    const isHomeShot = (s = state.shot) => s === 'home' || s === 'lobby';
    const isMatchShot = (s = state.shot) => s === 'match' || s === 'replay';
    const isSetupShot = (s = state.shot) => s === 'team' || s === 'rules';

    const planClock = createPlanClockController({ state, isHomeShot });
    const localPlayBlocked = () => planClock.localPlayBlocked();

    const CARD_TEXT = deps.CARD_TEXT ?? state.CARD_TEXT ?? 'no meter, back to spawn, out for a turn';
    const ubuCount = n => (fn('ubuCount') ? fn('ubuCount')(n) : `${n} ubu${n === 1 ? '' : 's'}`);
    const sideName = team => (fn('sideName') ? fn('sideName')(team) : $(team ? 'opponent-label' : 'home-label')?.textContent || (team ? 'CPU' : 'You'));
    const sideHas = team => (fn('sideHas') ? fn('sideHas')(team) : sideName(team) + (sideName(team) === 'You' ? ' have' : ' has'));

    let foulBoxEl = deps.foulBox ?? state.foulBox ?? null;
    if (!foulBoxEl && doc?.createElement && getStageArea()?.append) {
      foulBoxEl = doc.createElement('section');
      foulBoxEl.className = 'foul-info';
      foulBoxEl.hidden = true;
      foulBoxEl.setAttribute('role', 'dialog');
      foulBoxEl.setAttribute('aria-labelledby', 'foul-info-title');
      foulBoxEl.innerHTML = '<h3 id="foul-info-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01"/></svg><span></span></h3>' +
        '<div></div><button type="button">Got it</button>';
      getStageArea().append(foulBoxEl);
      state.foulBox = foulBoxEl;
    }

    function openFoulInfo(info) {
      const fb = state.foulBox ?? foulBoxEl;
      state.foulInfo = info;
      state.foulInfoKey = '';
      if (fb) fb.hidden = false;
      fn('draw')?.();
    }

    function closeFoulInfoImpl() {
      const fb = state.foulBox ?? foulBoxEl;
      if (!state.foulInfo) return;
      state.foulInfo = null;
      if (fb) fb.hidden = true;
      fn('draw')?.();
    }
    const closeFoulInfo = rawOverrides.closeFoulInfo ?? closeFoulInfoImpl;
    if (foulBoxEl?.querySelector) {
      const closeBtn = foulBoxEl.querySelector('button');
      if (closeBtn && !closeBtn.onclick) closeBtn.onclick = () => closeFoulInfo();
    }

    function foulInfoLinesImpl() {
      const P = getP(), ububallMatch = getMatch();
      const viewBodies = state.fieldView?.bodies || state.bodies || [];
      const ubus = viewBodies.slice(0, 6);
      if (state.foulInfo.kind === 'corner') {
        const [home, away] = (fn('cornerTeams')?.() || [[], []]).map(list => list.length);
        return ['Corner stalling', [
          { text: `The ball has been in this corner for ${state.fouls.cornerTurns} turns.` },
          { text: 'Clear it out this turn.', act: true },
          { text: `Otherwise it resets to centre ice and the side with more ubus here is yellow-carded: ${CARD_TEXT}.` },
          { text: home !== away ? `${sideName(home > away ? 0 : 1)} would be carded (${Math.max(home, away)} to ${Math.min(home, away)}).`
            : home ? `Even at ${home} each, so nobody would be carded.` : 'Nobody is here, so nobody would be carded.' }
        ]];
      }
      const t = state.foulInfo.team;
      const isCreasing = fn('isCreasing');
      const crease = ubus.filter(b => b.team === t && isCreasing?.(b, t)).length;
      const allowed = Math.max(1, ubus.filter(b => b.team === 1 - t && ububallMatch.inAttackZone(P, b, t)).length);
      return ['Goal camping', [
        { text: `${sideHas(t)} ${ubuCount(crease)} in the crease. Only ${allowed} ${allowed === 1 ? 'is' : 'are'} allowed: one per opponent in the attack zone, at least one.` },
        { text: `${sideName(t)} must move ${Math.max(1, crease - allowed)} out this turn.`, act: true },
        { text: `Otherwise every ubu left in the crease is yellow-carded: ${CARD_TEXT}.` }
      ]];
    }
    const foulInfoLines = rawOverrides.foulInfoLines ?? foulInfoLinesImpl;

    function updateFoulInfo() {
      if (!state.foulInfo) return;
      const fb = state.foulBox ?? foulBoxEl;
      if (state.foulInfo.kind === 'crease' ? !state.fouls?.crease?.[state.foulInfo.team] : !fn('stalling')?.()) {
        state.foulInfo = null;
        if (fb) fb.hidden = true;
        return;
      }
      if (state.cameraMove) {
        if (fb) fb.hidden = true;
        return;
      }
      if (fb) fb.hidden = false;
      const [title, lines] = foulInfoLines(), key = title + JSON.stringify(lines);
      if (key !== state.foulInfoKey) {
        state.foulInfoKey = key;
        if (fb) {
          const span = fb.querySelector('span');
          if (span) span.textContent = title;
          const boxDiv = fb.querySelector('div');
          const d = getDoc();
          if (boxDiv && d?.createElement) {
            boxDiv.replaceChildren(...lines.map(line => {
              const p = d.createElement('p');
              p.textContent = line.text;
              if (line.act) p.className = 'act';
              return p;
            }));
          }
        }
      }
      const f = state.fieldBox, far = state.foulInfo.kind === 'crease' ? state.foulInfo.team === 0 : state.fouls.corner % 2 === 0;
      const portrait = Boolean(state.fieldView?.portrait);
      const along = portrait ? (far ? 0.27 : 0.73) : (far ? 0.7 : 0.3);
      const scale = getGameUi()?.scale?.() || 1;
      if (fb && f) {
        fb.style.width = Math.min(340 * scale, portrait ? f.width - 24 * scale : f.width * 0.46) + 'px';
        fb.style.maxHeight = (portrait ? f.height * 0.5 : f.height) - 12 * scale + 'px';
        fb.style.left = f.left + f.width * (portrait ? 0.5 : along) + 'px';
        fb.style.top = f.top + f.height * (portrait ? along : 0.5) + 'px';
      }
    }

    function positionFirstTurnGuide() {
      if (!state.firstTurnStep || !state.fieldBox) return;
      const P = getP(), guide = $('first-turn-guide');
      if (!guide) return;
      const portrait = Boolean(state.fieldView?.portrait);
      const top = stagePoint(portrait ? { x: P.rink.right, y: 300 } : { x: 500, y: P.rink.top });
      guide.style.setProperty('--tip-x', top.x + 'px');
      guide.style.setProperty('--tip-y', Math.max(8, top.y + 10) + 'px');
      guide.style.setProperty('--tip-width', Math.max(130, state.fieldBox.width * 0.8) + 'px');
    }

    function updateFirstTurnGuide() {
      const visible = state.firstTurnStep !== null && state.shot === 'match' && !state.cameraMove && state.phase === 'plan' && !state.online?.active;
      const guideEl = $('first-turn-guide');
      if (guideEl) guideEl.hidden = !visible;
      if (!visible) return;
      if (!state.drag && state.plans?.some(plan => plan.power > 0)) state.firstTurnStep = 'launch';
      const tip = state.firstTurnStep === 'launch'
        ? 'Aim any other ubus, then press Launch team. Both teams move together.'
        : state.pullBehind ? 'Pull back from an ubu to aim. Pull farther for more power.'
          : 'Drag from an ubu to aim. Drag farther for more power.';
      const tipEl = $('first-turn-tip');
      if (tipEl && tipEl.textContent !== tip) tipEl.textContent = tip;
      positionFirstTurnGuide();
    }

    function animateFirstTurnGuide(time, active) {
      const arrow = $('first-turn-arrow');
      if (!arrow) return;
      if (!active || state.shot !== 'match' || state.cameraMove || state.firstTurnStep !== 'aim' || state.phase !== 'plan' || state.drag !== null || state.online?.active || !state.fieldBox) {
        if (state.firstTurnStarted !== null) {
          state.firstTurnStarted = null;
          arrow.removeAttribute('d');
          fn('hideFinger')?.();
        }
        return;
      }
      const viewBodies = state.fieldView?.bodies || state.bodies || [];
      const body = viewBodies[state.selected];
      if (!body) return;
      state.firstTurnStarted ??= time;
      const still = Boolean(getReducedMotion()?.matches), age = still ? 1550 : (time - state.firstTurnStarted) % 2500;
      if (age >= 2000) { arrow.removeAttribute('d'); fn('hideFinger')?.(); return; }
      const progress = Math.max(0, Math.min(1, (age - 450) / 850));
      const eased = 1 - (1 - progress) ** 3;
      const impFn = fn('impulseGeometry');
      const sample = impFn(body, { angle: 0, power: 0.65 });
      const distance = (state.pullBehind ? 84 : sample.distance) * eased;
      const impulse = impFn(body, { angle: 0, power: aimPower(distance, sample) });
      fn('placeFinger')?.(body.x + (state.pullBehind ? -distance : distance), body.y);
      const finger = $('demo-finger');
      if (finger) {
        finger.toggleAttribute('hidden', false);
        finger.classList.toggle('pressed', !still && age >= 300 && age < 1400);
      }
      if (!impulse.visible) { arrow.removeAttribute('d'); return; }
      const from = stagePoint({ x: body.x + impulse.ringR, y: body.y }), to = stagePoint(impulse);
      const top = stagePoint({ x: impulse.x - 13, y: impulse.y - 8 });
      const bottom = stagePoint({ x: impulse.x - 13, y: impulse.y + 8 });
      arrow.setAttribute('d', `M${from.x} ${from.y} L${to.x} ${to.y} M${top.x} ${top.y} L${to.x} ${to.y} L${bottom.x} ${bottom.y}`);
    }

    function closeFirstTurnGuide(remember = false) {
      if (remember && state.firstTurnStep !== null) {
        state.firstTurnSeen = true;
        try { getStorage()?.setItem?.(state.firstTurnKey || 'ububall-first-turn-guide', 'seen'); } catch {}
      }
      if (state.firstTurnStep !== null) {
        state.firstTurnStep = null;
        animateFirstTurnGuide(0, false);
      }
      const guideEl = $('first-turn-guide');
      if (guideEl) guideEl.hidden = true;
    }

    const skipFirstTurn = $('skip-first-turn-guide');
    if (skipFirstTurn && !skipFirstTurn.onclick) {
      skipFirstTurn.onclick = () => {
        closeFirstTurnGuide(true);
        $('launch')?.focus?.();
      };
    }

    const KNOB_SWEEP = 150;
    const KNOB_RANGE = { angle: [0, 360], power: [0, 100], spin: [-100, 100] };
    const screenDegrees = angle => ((angle * 180 / Math.PI + 90 - (state.fieldView?.portrait ? 90 : 0)) % 360 + 360) % 360;
    function knobValue(kind, i) {
      const plan = state.plans[i];
      return kind === 'angle' ? screenDegrees(plan.angle) : kind === 'power' ? plan.power * 100 : (plan.spin || 0) * 100;
    }
    const knobEditable = i => state.phase === 'plan' && Boolean(state.plans?.[i] && (state.fieldView?.bodies || state.bodies)?.[i] && !(state.fieldView?.bodies || state.bodies)[i].stunned && !(state.fieldView?.bodies || state.bodies)[i].carded);
    function setKnob(kind, i, value, deferDraw = false) {
      if (!knobEditable(i)) return;
      const plan = state.plans[i], [min, max] = KNOB_RANGE[kind];
      if (kind === 'angle') plan.angle = (((value - 90 + (state.fieldView?.portrait ? 90 : 0)) % 360 + 360) % 360) * Math.PI / 180;
      else plan[kind] = Math.max(min, Math.min(max, value)) / 100;
      plan.guard = false;
      if (deferDraw) { state.dragDirty = true; return; }
      fn('sync')?.(); fn('draw')?.();
    }

    function aimPowerImpl(distance, arrow) {
      const power = state.pullBehind ? (distance - 6) / 120 : (distance - arrow.ringR) / arrow.scale;
      return Math.max(0, Math.min(1, power));
    }
    const aimPower = rawOverrides.aimPower ?? aimPowerImpl;

    function boxPoint(r, p) {
      return state.fieldView?.portrait
        ? { x: r.left + p.y / 600 * r.width, y: r.top + (1 - p.x / 1000) * r.height }
        : { x: r.left + p.x / 1000 * r.width, y: r.top + p.y / 600 * r.height };
    }
    const screenPoint = p => boxPoint(state.fieldView.canvas.getBoundingClientRect(), p);

    function pointImpl(event) {
      const r = state.fieldView.canvas.getBoundingClientRect();
      if (state.fieldView.portrait) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = event.clientX - cx;
        const dy = event.clientY - cy;
        return {
          x: Math.min(1000, Math.max(0, 500 - (dy / r.height) * 1000)),
          y: Math.min(600, Math.max(0, 300 + (dx / r.width) * 600))
        };
      }
      return {
        x: (event.clientX - r.left) * 1000 / r.width,
        y: (event.clientY - r.top) * 600 / r.height
      };
    }
    const point = rawOverrides.point ?? pointImpl;

    function fieldTargetImpl(event) {
      const scale = getGameUi()?.scale?.() || 1;
      const near = p => { const q = screenPoint(p); return Math.hypot(q.x - event.clientX, q.y - event.clientY) <= 22 * scale; };
      const own = (state.fieldView?.bodies || state.bodies || []).slice(0, 3);
      const impFn = fn('impulseGeometry');
      const arrow = own.findIndex((b, i) => { const a = impFn(b, state.plans[i]); return a.visible && near(a); });
      if (arrow >= 0) return { mode: 'arrow', index: arrow };
      const p = point(event);
      return { mode: 'aim', index: own.findIndex(b => !b.stunned && !b.carded && Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 12) };
    }
    const fieldTarget = rawOverrides.fieldTarget ?? fieldTargetImpl;

    function measureField() {
      const canvas = state.fieldView?.canvas, stageArea = getStageArea(), control = $('field-spin');
      if (!canvas || !stageArea || !control) return;
      const r = canvas.getBoundingClientRect(), stage = stageArea.getBoundingClientRect();
      const fx = state.fieldEffects;
      state.fieldBox = {
        left: r.left - stage.left - (fx?.shakeX || 0),
        top: r.top - stage.top - (fx?.shakeY || 0),
        width: r.width,
        height: r.height,
        stageWidth: stage.width,
        stageHeight: stage.height,
        controlWidth: control.offsetWidth,
        controlHeight: control.offsetHeight
      };
      positionFirstTurnGuide();
    }

    const stagePointImpl = p => boxPoint(state.fieldBox, p);
    const stagePoint = rawOverrides.stagePoint ?? stagePointImpl;
    const posSpinCtrl = () => positionSpinControl({ state, stagePoint: (...a) => stagePoint(...a) });

    function stepCollectionLength() {
      state.collectionLengthRaf = 0;
      if (state.shot !== 'collection' || state.collectionLengthOverride !== null || state.collectionRotateHold) return;
      const diff = state.collectionTargetLength - state.collectionShownLength;
      const rs = getRinkStage();
      if (Math.abs(diff) <= 1.5 || getReducedMotion()?.matches) {
        state.collectionShownLength = state.collectionTargetLength;
        rs?.style?.removeProperty?.('--collection-hold-h');
        state.layoutDirty = true;
        fn('draw')?.();
        return;
      }
      state.collectionShownLength += diff * 0.24;
      if (rs && rs.clientWidth > 0) {
        rs.style?.setProperty?.('--collection-hold-h', Math.round(rs.clientWidth * state.collectionShownLength / 600) + 'px');
      }
      state.layoutDirty = true;
      fn('draw')?.();
      const raf = getRaf();
      if (typeof raf === 'function') state.collectionLengthRaf = raf(stepCollectionLength);
    }

    const WIDE_STAGE_QUERY = '(min-width: 56rem) and (orientation: landscape) and (not ((pointer: coarse) and (max-height: 600px)))';
    const mm = getMatchMedia();
    const portraitScreen = deps.portraitScreen ?? state.portraitScreen ?? mm?.('(orientation: portrait)') ?? { matches: false };
    const wideScreen = deps.wideScreen ?? state.wideScreen ?? (mm ? mm(WIDE_STAGE_QUERY) : { matches: true });
    const fullscreenDisplay = deps.fullscreenDisplay ?? state.fullscreenDisplay ?? mm?.('(display-mode: fullscreen)') ?? { matches: false };

    const compactPhoneStage = () => Boolean(portraitScreen?.matches) || !wideScreen.matches;

    function settleCameraPromise() {
      if (state.resolveCameraDone) {
        const done = state.resolveCameraDone;
        state.resolveCameraDone = null;
        done();
      }
    }

    function clearCameraArtifacts() {
      const cancelRaf = getCancelRaf();
      if (state.cameraStepRaf && typeof cancelRaf === 'function') cancelRaf(state.cameraStepRaf);
      state.cameraStepRaf = 0;
      state.afterCollectionShrink = null;
      state.collectionRotateHold = false;
      state.collectionLengthOverride = null;
      state.collectionShrinkingBox = null;
      const rs = getRinkStage();
      rs?.classList?.remove?.('collection-rotating', 'collection-shrinking');
      rs?.style?.removeProperty?.('--shrink-left');
      rs?.style?.removeProperty?.('--shrink-top');
    }

    function cancelActiveCamera() {
      if (state.cameraMove) { state.cameraMove.cancel(); state.cameraMove = null; }
      getStadium()?.classList?.remove?.('camera-moving');
      clearCameraArtifacts();
      settleCameraPromise();
    }

    function finishCameraMove() {
      state.cameraMove = null;
      getStadium()?.classList?.remove?.('camera-moving');
      clearCameraArtifacts();
      settleCameraPromise();
      updateFirstTurnGuide();
      state.layoutDirty = true;
      fn('draw')?.();
    }

    function camera(change, prevShot = state.shot, nextShot = state.shot) {
      const now = getPerf()?.now?.() ?? 0;
      const rs = getRinkStage(), st = getStadium(), fv = state.fieldView, d = getDoc();
      const ububallMatch = getMatch(), P = getP(), win = getWin();
      let from = rs.getBoundingClientRect(), turned = Boolean(fv?.portrait);
      let fromCollection = prevShot === 'collection' && nextShot !== 'collection';
      let savedExit = null;
      const resumeShrink = state.collectionShrinkingBox ? { ...state.collectionShrinkingBox } : null;
      if (fromCollection && from.width > 0) {
        const curLen = fv?.collectionPortrait?.length ||
          (typeof state.collectionShownLength === 'number' && state.collectionShownLength > 0 ? state.collectionShownLength : 0) ||
          Math.max(1000, 600 * (from.height / Math.max(1, from.width)));
        savedExit = { rect: from, at: now, length: Math.max(1000, curLen) };
        state.pendingExitCollection = savedExit;
      } else if (!fromCollection && nextShot !== 'collection' && state.pendingExitCollection &&
        (resumeShrink || (now - state.pendingExitCollection.at) < 120)) {
        fromCollection = true;
        savedExit = state.pendingExitCollection;
        from = savedExit.rect;
      } else {
        state.pendingExitCollection = null;
      }
      if (fromCollection) {
        const cancelRaf = getCancelRaf();
        if (state.collectionLengthRaf && typeof cancelRaf === 'function') {
          cancelRaf(state.collectionLengthRaf);
          state.collectionLengthRaf = 0;
        }
        if (state.collectionScrollRaf && typeof cancelRaf === 'function') {
          cancelRaf(state.collectionScrollRaf);
          state.collectionScrollRaf = 0;
        }
      }
      const enteringCollection = prevShot !== 'collection' && nextShot === 'collection';
      if (state.cameraMove || state.cameraStepRaf) cancelActiveCamera();
      const raf = getRaf();
      const reduced = Boolean(getReducedMotion()?.matches);

      if (enteringCollection) {
        const canAnim = Boolean(rs.animate) && !compactPhoneStage() && !reduced && !d?.hidden && from.width > 0;
        if (!canAnim) {
          change();
          state.layoutDirty = true;
          fn('draw')?.();
          return;
        }
        state.collectionRotateHold = true;
        state.collectionLengthOverride = 1000;
        rs.classList.add('collection-rotating');
        change();
        state.layoutDirty = true;
        fn('draw')?.();
        const to1 = rs.getBoundingClientRect();
        if (!(to1.width > 0 && to1.height > 0)) {
          clearCameraArtifacts();
          state.layoutDirty = true;
          fn('draw')?.();
          return;
        }
        const dx = from.left + from.width / 2 - (to1.left + to1.width / 2);
        const dy = from.top + from.height / 2 - (to1.top + to1.height / 2);
        const startTransform = turned
          ? `translate(${dx}px, ${dy}px) scale(${from.width / to1.width})`
          : `translate(${dx}px, ${dy}px) rotate(90deg) scale(${from.width / to1.height})`;
        st?.classList?.add?.('camera-moving');
        state.cameraDone = new Promise(resolve => { state.resolveCameraDone = resolve; });
        const move1 = state.cameraMove = rs.animate([{ transform: startTransform }, { transform: 'none' }],
          { duration: 480, easing: 'cubic-bezier(.3, .8, .2, 1)' });
        posSpinCtrl(); updateFirstTurnGuide(); updateFoulInfo();
        move1.onfinish = () => {
          if (state.cameraMove !== move1) return;
          state.collectionRotateHold = false;
          rs.classList.remove('collection-rotating');
          state.layoutDirty = true;
          fn('draw')?.();
          const to2 = rs.getBoundingClientRect();
          const minH = to1.height || (to2.width * 5 / 3);
          const fullH = Math.max(minH, to2.height);
          const cw = $('collection-world');
          cw?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
          if (fullH <= minH + 4) {
            finishCameraMove();
            return;
          }
          const targetLen = Math.max(1000, 600 * (fullH / Math.max(1, to2.width)));
          const dur = 360, t0 = getPerf()?.now?.() ?? 0;
          state.collectionLengthOverride = 1000;
          const move2 = state.cameraMove = rs.animate([
            { clipPath: `inset(0 0 ${Math.max(0, fullH - minH)}px 0)` },
            { clipPath: 'inset(0 0 0px 0)' }
          ], { duration: dur, easing: 'cubic-bezier(.25, .85, .25, 1)' });
          if (typeof raf === 'function') {
            const tickStretch = ts => {
              if (state.cameraMove !== move2) return;
              const p = Math.min(1, Math.max(0, (ts - t0) / dur));
              const eased = 1 - (1 - p) ** 3;
              state.collectionLengthOverride = 1000 + (targetLen - 1000) * eased;
              state.layoutDirty = true;
              fn('draw')?.();
              if (p < 1) state.cameraStepRaf = raf(tickStretch);
            };
            state.cameraStepRaf = raf(tickStretch);
          }
          move2.onfinish = () => {
            if (state.cameraMove !== move2) return;
            state.collectionShownLength = state.collectionTargetLength = targetLen;
            finishCameraMove();
          };
        };
        return;
      }

      if (fromCollection) {
        state.pendingExitCollection = savedExit;
        change();
        const canAnim = Boolean(rs.animate) && !compactPhoneStage() && !reduced && !d?.hidden && from.width > 0;
        if (!canAnim) {
          state.pendingExitCollection = null;
          state.layoutDirty = true;
          fn('draw')?.();
          return;
        }
        const wCol = from.width, pxPerUnit = Math.max(0.01, wCol / 600), hMin = wCol * 5 / 3;
        const vh = (win && win.innerHeight) || d?.documentElement?.clientHeight || 860;
        const rawStartTop = resumeShrink ? resumeShrink.stageTop : from.top;
        const fromBottom = typeof from.bottom === 'number' ? from.bottom : (from.top + from.height);
        const minCoverLen = 600 * (Math.max(0, Math.min(vh, fromBottom) - rawStartTop) / Math.max(1, wCol));
        const rawStartLen = Math.max(1000, minCoverLen, resumeShrink?.length || savedExit?.length || (600 * (from.height / Math.max(1, wCol))));
        const startBottom = rawStartTop + (wCol * rawStartLen / 600);
        const visBottomRef = Math.max(Math.min(vh, hMin), Math.min(vh, Math.max(fromBottom, startBottom)));
        const rotStageTop = Math.max(rawStartTop, visBottomRef - hMin);
        st?.classList?.add?.('camera-moving');
        state.cameraDone = new Promise(resolve => { state.resolveCameraDone = resolve; });

        const startRotateBack = () => {
          state.pendingExitCollection = null;
          state.collectionShrinkingBox = null;
          rs.classList.remove('collection-shrinking');
          rs.style?.removeProperty?.('--shrink-left');
          rs.style?.removeProperty?.('--shrink-top');
          state.layoutDirty = true;
          fn('draw')?.();
          const runDeferred = state.afterCollectionShrink;
          state.afterCollectionShrink = null;
          runDeferred?.();
          const to = rs.getBoundingClientRect();
          if (!(to.width > 0 && to.height > 0)) {
            finishCameraMove();
            return;
          }
          const dx = (from.left + wCol / 2) - (to.left + to.width / 2);
          const dy = (rotStageTop + hMin / 2) - (to.top + to.height / 2);
          const startPose = fv?.portrait
            ? `translate(${dx}px, ${dy}px) scale(${wCol / to.width})`
            : `translate(${dx}px, ${dy}px) rotate(-90deg) scale(${wCol / to.height})`;
          const rotMove = state.cameraMove = rs.animate([{ transform: startPose }, { transform: 'none' }],
            { duration: 480, easing: 'cubic-bezier(.3, .8, .2, 1)' });
          posSpinCtrl(); updateFirstTurnGuide(); updateFoulInfo();
          rotMove.onfinish = () => {
            if (state.cameraMove !== rotMove) return;
            finishCameraMove();
          };
        };

        if (rawStartLen > 1006) {
          const zoneOffset = ububallMatch.attackZoneLine(P, 0) - P.rink.left;
          const periodUnits = 2 * Math.max(120, 500 - (60 + zoneOffset));
          let shrinkFromLen = rawStartLen, shrinkFromTop = rawStartTop;
          const periodAdjusted = Boolean(resumeShrink?.periodAdjusted);
          if (!periodAdjusted && shrinkFromLen > 1000 + periodUnits && shrinkFromTop < -300 * pxPerUnit) {
            const maxByLen = Math.floor((shrinkFromLen - (1000 + periodUnits)) / periodUnits);
            const maxByTop = Math.floor((-300 * pxPerUnit - shrinkFromTop) / (periodUnits * pxPerUnit));
            const periods = Math.max(0, Math.min(maxByLen, maxByTop));
            if (periods > 0) {
              shrinkFromLen -= periods * periodUnits;
              shrinkFromTop += periods * periodUnits * pxPerUnit;
            }
          }
          const visStartTop = Math.max(0, shrinkFromTop);
          const visStartBot = Math.max(visStartTop + 1, Math.min(vh, shrinkFromTop + wCol * shrinkFromLen / 600));
          const visEndTop = Math.max(0, rotStageTop);
          const visEndBot = Math.max(visEndTop + 1, Math.min(vh, rotStageTop + hMin));
          const visibleTravelPx = Math.max(Math.abs(rotStageTop - shrinkFromTop), Math.max(0, visStartBot - visEndBot));
          const dur = visibleTravelPx < 4 ? 16 : Math.round(Math.min(260, Math.max(120, visibleTravelPx * 0.45)));
          const canvasH = resumeShrink?.canvasH || Math.max(120, Math.round(Math.min(wCol * rawStartLen / 600, vh)));
          state.collectionShrinkingBox = { left: from.left, stageTop: shrinkFromTop, width: wCol, length: shrinkFromLen, canvasH, periodAdjusted: true };
          rs.classList.add('collection-shrinking');
          rs.style?.setProperty?.('--shrink-left', `${from.left}px`);
          rs.style?.setProperty?.('--shrink-top', `${visStartTop}px`);
          state.layoutDirty = true;
          fn('draw')?.();
          const t0 = getPerf()?.now?.() ?? 0;
          const shrinkMove = state.cameraMove = rs.animate([{ opacity: 1 }, { opacity: 1 }], { duration: dur, easing: 'cubic-bezier(.35, 0, .25, 1)' });
          posSpinCtrl(); updateFirstTurnGuide(); updateFoulInfo();
          if (typeof raf === 'function') {
            const tickShrink = ts => {
              if (state.cameraMove !== shrinkMove) return;
              const p = Math.min(1, Math.max(0, (ts - t0) / dur));
              const eased = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
              if (state.collectionShrinkingBox) {
                state.collectionShrinkingBox.length = shrinkFromLen + (1000 - shrinkFromLen) * eased;
                state.collectionShrinkingBox.stageTop = shrinkFromTop + (rotStageTop - shrinkFromTop) * eased;
              }
              state.layoutDirty = true;
              fn('draw')?.();
              if (p < 1) state.cameraStepRaf = raf(tickShrink);
            };
            state.cameraStepRaf = raf(tickShrink);
          }
          shrinkMove.onfinish = () => {
            if (state.cameraMove !== shrinkMove) return;
            const cancelRaf = getCancelRaf();
            if (state.cameraStepRaf && typeof cancelRaf === 'function') cancelRaf(state.cameraStepRaf);
            state.cameraStepRaf = 0;
            startRotateBack();
          };
        } else {
          startRotateBack();
        }
        return;
      }

      change();
      state.layoutDirty = true;
      fn('draw')?.();
      const to = rs.getBoundingClientRect();
      if (!rs.animate || compactPhoneStage() || turned || fv?.portrait || reduced || d?.hidden || !from.width || !to.width) return;
      const dx = from.left + from.width / 2 - to.left - to.width / 2, dy = from.top + from.height / 2 - to.top - to.height / 2;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(from.width - to.width) < 1) return;
      st?.classList?.add?.('camera-moving');
      state.cameraDone = new Promise(resolve => { state.resolveCameraDone = resolve; });
      const move = state.cameraMove = rs.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` }, { transform: 'none' }],
        { duration: 520, easing: 'cubic-bezier(.3, .8, .2, 1)' });
      posSpinCtrl(); updateFirstTurnGuide(); updateFoulInfo();
      move.onfinish = () => {
        if (state.cameraMove !== move) return;
        finishCameraMove();
      };
    }

    const winObj = getWin();
    if (winObj) winObj.ubuStageReady = () => state.cameraDone;

    function updateReplaySkip(replay) {
      const replaySkip = deps.replaySkip ?? state.replaySkip ?? $('skip-goal-replay');
      if (!replaySkip) return;
      const replaySkipHint = deps.replaySkipHint ?? state.replaySkipHint ?? replaySkip.firstElementChild;
      if (!replay || state.shot !== 'match' || state.demo || state.online?.spectating) {
        if (!replaySkip.hidden) replaySkip.hidden = true;
        return;
      }
      if (replaySkip.hidden) replaySkip.hidden = false;
      const requested = state.online?.active && state.online.state?.playUntil !== null;
      const final = state.online?.active ? state.online.state?.game?.winner !== null : state.phase === 'over';
      const label = requested ? 'Continuing after replay…' : final ? 'Tap for results' : 'Tap for next round';
      const now = getPerf()?.now?.() ?? 0;
      const shownMs = state.online?.active ? now - replay.started : (replay.elapsedMs ?? (now - replay.started));
      const hideHint = !requested && replay.loops < 2 && shownMs < 3000;
      if (replaySkipHint && replaySkipHint.hidden !== hideHint) replaySkipHint.hidden = hideHint;
      if (replaySkipHint && replaySkipHint.textContent !== label) replaySkipHint.textContent = label;
    }

    function setShot(next, { keepPortrait = false, beforeLayout = null } = {}) {
      const d = getDoc();
      if (!beforeLayout && state.shot === next && d?.body?.dataset?.shot === next) return;
      if (state.drag !== null && next !== 'match') endCanvasDrag();
      const prevShot = state.shot;
      camera(() => {
        beforeLayout?.();
        state.shot = next;
        if (d?.body?.dataset) d.body.dataset.shot = next;
        if (isSetupShot(next)) {
          getScrollTo()?.(0, 0);
          setPortrait(false);
          fitSetupShot();
        } else if (isMatchShot(next)) {
          if (keepPortrait) setPortrait(state.returnPortrait);
          else fitOrientation();
        } else {
          setPortrait(false);
        }
        syncFullscreenButton();
        fn('fitScorebug')?.();
      }, prevShot, next);
      updateReplaySkip(state.shot === 'match' ? state.goalReplay : null);
    }

    function endCanvasDragImpl() {
      state.arrowGrab = null;
      state.drag = null;
      state.dragStart = null;
      state.dragStartClient = null;
      state.dragMode = null;
      state.dragDirty = false;
      if (state.phase === 'plan') fn('saveActiveMatch')?.();
      updateFirstTurnGuide();
      fn('sync')?.(); fn('draw')?.();
    }
    const endCanvasDrag = rawOverrides.endCanvasDrag ?? endCanvasDragImpl;

    const playableShot = () => state.shot === 'match' && !state.cameraMove;

    const canvas = state.fieldView?.canvas;
    if (canvas) {
      canvas.addEventListener?.('wheel', e => {
        if (playableShot() && !state.foulInfo && !e.ctrlKey) {
          (rawOverrides.wheelKnob ?? fn('wheelKnob'))?.(e, 'spin', state.selected);
        }
      }, { passive: false });
      canvas.onpointerdown = event => {
        if (!isMatchShot() || state.cameraMove) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (state.drag !== null) return;
        fn('gameAudio')?.()?.getAudioContext?.();
        const warning = fn('warningAt')?.(point(event));
        if (warning) { openFoulInfo(warning); return; }
        if (state.foulInfo) { closeFoulInfo(); return; }
        if (!playableShot() || state.phase !== 'plan') return;
        const p = point(event);
        const target = fieldTarget(event);
        if (target.index < 0) return;
        state.tapGuards = state.selected === target.index;
        state.selected = target.index;
        state.drag = event.pointerId;
        state.dragMode = target.mode;
        state.dragStart = p;
        state.dragStartClient = { x: event.clientX, y: event.clientY };
        state.dragMoved = false;
        if (state.dragMode === 'arrow') {
          const viewBodies = state.fieldView?.bodies || state.bodies || [];
          const arrow = fn('impulseGeometry')(viewBodies[state.selected], state.plans[state.selected]);
          state.arrowGrab = { x: p.x - arrow.x, y: p.y - arrow.y, distance: arrow.distance, power: state.plans[state.selected].power };
        }
        canvas.setPointerCapture?.(state.drag);
        fn('sync')?.(); fn('draw')?.();
      };
      canvas.onpointermove = event => {
        if (!isMatchShot() || state.cameraMove) { if (canvas.style) canvas.style.cursor = 'default'; return; }
        const p = point(event);
        if (state.drag !== event.pointerId || !playableShot() || state.phase !== 'plan') {
          if (fn('warningAt')?.(p)) { if (canvas.style) canvas.style.cursor = 'pointer'; }
          else if (playableShot() && state.phase === 'plan') {
            const target = fieldTarget(event);
            if (canvas.style) canvas.style.cursor = target.index < 0 ? 'default' : target.mode === 'arrow' ? 'grab' : 'crosshair';
          } else if (canvas.style) canvas.style.cursor = 'default';
          return;
        }
        const viewBodies = state.fieldView?.bodies || state.bodies || [];
        const b = viewBodies[state.selected];
        const scale = getGameUi()?.scale?.() || 1;
        const tapRadius = (event.pointerType === 'mouse' ? 5 : 12) * scale;
        if (!state.dragMoved && state.dragStartClient && Math.hypot(event.clientX - state.dragStartClient.x, event.clientY - state.dragStartClient.y) < tapRadius) return;
        state.dragMoved = true;
        state.plans[state.selected].guard = false;
        const impFn = fn('impulseGeometry');
        if (state.dragMode === 'arrow') {
          const dx = p.x - state.arrowGrab.x - b.x, dy = p.y - state.arrowGrab.y - b.y;
          const arrow = impFn(b, state.plans[state.selected]);
          const rawAngle = Math.atan2(dy, dx);
          state.plans[state.selected].angle = ((rawAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          state.plans[state.selected].power = Math.max(0, Math.min(1, state.arrowGrab.power + (Math.hypot(dx, dy) - state.arrowGrab.distance) / arrow.scale));
        } else if (state.dragMode === 'aim') {
          const dx = p.x - b.x, dy = p.y - b.y;
          const arrow = impFn(b, state.plans[state.selected]);
          const rawAngle = Math.atan2(state.pullBehind ? -dy : dy, state.pullBehind ? -dx : dx);
          state.plans[state.selected].angle = ((rawAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          state.plans[state.selected].power = aimPower(Math.hypot(dx, dy), arrow);
        }
        state.dragDirty = true;
      };
      canvas.onpointerup = canvas.onpointercancel = event => {
        if (state.drag !== event.pointerId) return;
        if (event.type === 'pointerup' && state.dragMode === 'aim' && !state.dragMoved && state.tapGuards) fn('toggleGuard')?.(state.selected);
        endCanvasDrag();
      };
      canvas.onlostpointercapture = event => {
        if (state.drag !== event.pointerId) return;
        endCanvasDrag();
      };
    }

    function teamHint(classic) {
      const hint = $('roster-hint');
      if (!hint) return;
      const locked = Boolean(fn('teamLocked')?.());
      const fixed = Boolean(fn('fixedTeam')?.());
      const text = locked ? 'Your team is locked in. Choose Change team to edit it.' :
        fixed ? (classic ? 'Guests play with these three ubus.' : 'Guests play with these three ubus. Pick each ubu’s super with its super button.') : '';
      hint.textContent = text;
    }

    const sheetOpen = () => Boolean($('roster-dialog')?.classList?.contains?.('open'));

    function fitSetupShotImpl() {
      const d = getDoc();
      if (isSetupShot() && d?.querySelector?.('.ball-page')) {
        d.body.style.setProperty('--setup-top', Math.round(d.querySelector('.ball-page').getBoundingClientRect().top + getScrollY()) + 'px');
      }
    }
    const fitSetupShot = rawOverrides.fitSetupShot ?? fitSetupShotImpl;

    function skateLineup(on) {
      const slots = $('roster-slots');
      if (!slots) return;
      state.lineupMove?.cancel?.(); state.lineupMove = null;
      slots.inert = !on;
      if (getReducedMotion()?.matches || !slots.animate) { if (!on) slots.replaceChildren(); return; }
      const off = { translate: '-45cqw 0', opacity: 0 }, at = { translate: '0 0', opacity: 1 };
      const move = state.lineupMove = slots.animate(on ? [off, at] : [at, off], { duration: on ? 480 : 260, delay: on ? 240 : 0, easing: on ? 'cubic-bezier(.2, .8, .2, 1)' : 'ease-in', fill: 'both' });
      move.onfinish = () => {
        if (state.lineupMove !== move) return;
        if (!on) slots.replaceChildren();
        move.cancel(); state.lineupMove = null;
      };
    }

    function resetSetupSlots() {
      if (sheetOpen()) return;
      state.lineupMove?.cancel?.(); state.lineupMove = null;
      const slots = $('roster-slots');
      if (slots) slots.inert = false;
    }

    function setupStep(step) {
      const sheet = $('roster-dialog'), slotsEl = $('roster-slots');
      if (!sheet) return;
      const hadLineup = (slotsEl?.childElementCount || 0) > 0;
      const ububallMatch = getMatch();
      const renderFn = fn('ubuRender') ?? state.ubuRender;
      sheet.dataset.step = step; sheet.dataset.for = state.setupFor;
      const nextBtn = $('sheet-next');
      if (nextBtn) {
        nextBtn.textContent = state.setupFor === 'rules' ? 'Apply rules' : state.setupFor === 'online' ? 'Next: online match' : 'Choose team';
        nextBtn.classList.toggle('primary', state.setupFor !== 'cpu');
      }
      const shortcut = step === 'mode' && state.setupFor === 'cpu';
      const startBtn = $('sheet-start');
      if (startBtn) startBtn.hidden = !shortcut;
      if (shortcut) {
        const complete = state.draft.length === 3 && state.draft.every(entry => entry?.model);
        const signed = Boolean(fn('signedIn')?.());
        const slots = complete && signed ? fn('teamSlotsOf')?.(state.draft) : null;
        const selectedTeam = state.savedTeams?.teams?.[state.teamIndex];
        const same = fn('sameSlots');
        const name = same?.(slots, selectedTeam?.slots) ? selectedTeam.name : state.savedTeams?.teams?.find(team => same?.(slots, team.slots))?.name;
        if (startBtn) startBtn.disabled = !complete || (signed && !slots);
        const nameEl = $('sheet-team-name');
        if (nameEl) { nameEl.textContent = name || ''; nameEl.hidden = !name; }
        $('sheet-team-preview')?.replaceChildren?.(...state.draft.filter(entry => entry?.model).map(entry =>
          renderFn?.spriteImg ? renderFn.spriteImg(entry.model, 'sheet-team-art', 256) : renderFn?.(entry.model, 'sheet-team-art')
        ));
      }
      const lobbyPanel = $('lobby-panel');
      if (lobbyPanel) lobbyPanel.hidden = state.setupFor !== 'lobby';
      const titleEl = $('team-title');
      if (titleEl) titleEl.textContent = state.setupFor === 'lobby' ? 'Online match' : 'Your team';
      const backBtn = $('team-back');
      if (backBtn) backBtn.hidden = state.setupFor === 'pick' || (state.setupFor === 'lobby' && !state.lobbyView?.state?.canChangeRules);
      if (step === 'team') {
        const tmEl = $('team-mode');
        if (tmEl) tmEl.textContent = ububallMatch.modeName(state.setupFor === 'lobby' ? state.lobbyView.state.mode : fn('chosenMode')());
        if (!fn('fixedTeam')?.()) { void fn('loadCollection')?.(); void fn('loadTeams')?.(); }
        fn('rosterSlots')?.();
      } else {
        if (state.setupFor === 'cpu') fn('rosterSlots')?.();
        else if (!sheetOpen()) slotsEl?.replaceChildren?.();
      }
      const startMatchEl = $('start-match');
      if (startMatchEl) {
        startMatchEl.textContent = state.setupFor === 'pick' ? 'Use team' : state.setupFor !== 'lobby' ? 'Start match' : state.lobbyView?.ready ? 'Change team' : 'Ready to play';
      }
      if (sheetOpen()) {
        setShot(step === 'team' ? 'team' : 'rules');
        const wantsLineup = step === 'team' || state.setupFor === 'cpu';
        if (!hadLineup && wantsLineup && (slotsEl?.childElementCount || 0) > 0) skateLineup(true);
        else if (hadLineup && !wantsLineup) skateLineup(false);
      }
    }

    function openSheet() {
      const sheet = $('roster-dialog');
      if (!sheet) return;
      state.handoffToMatch = false;
      if (sheetOpen()) return;
      if (!isSetupShot()) {
        state.returnShot = state.setupFor === 'lobby' ? homeShot : state.shot;
        state.returnPortrait = state.setupFor === 'lobby' ? false : Boolean(state.fieldView?.portrait);
      }
      for (const id of ['pause-menu', 'match-help', 'stats-dialog', 'match-summary', 'replays-dialog', 'online-dialog']) {
        if ($(id)?.open) $(id).close();
      }
      const drawer = getStatDrawer();
      if (drawer?.matches?.(':popover-open')) drawer.hidePopover();
      closeFoulInfo();
      sheet.classList.add('open');
      setShot(sheet.dataset.step === 'team' ? 'team' : 'rules');
      fn('castTo')?.(true);
      const rs = getRinkStage();
      if ($('roster-slots')?.childElementCount) {
        if (rs?.classList?.contains?.('collection-shrinking')) {
          const prevDeferred = state.afterCollectionShrink;
          state.afterCollectionShrink = () => {
            prevDeferred?.();
            if (sheetOpen() && $('roster-slots')?.childElementCount) skateLineup(true);
          };
        } else {
          skateLineup(true);
        }
      }
    }

    function closeSheet() {
      const sheet = $('roster-dialog');
      if (!sheet) return;
      if (!sheetOpen()) { state.handoffToMatch = false; return; }
      if ($('roster-super')?.matches?.(':popover-open')) $('roster-super').hidePopover();
      if ($('team-menu')?.matches?.(':popover-open')) $('team-menu').hidePopover();
      sheet.classList.remove('open');
      if (!state.handoffToMatch) leaveSetupShot(false);
    }

    function cancelSheet() {
      if (!sheetOpen()) return;
      if ($('roster-dialog')?.dataset?.step === 'team' && state.setupFor !== 'lobby' && state.setupFor !== 'pick') setupStep('mode');
      else closeSheet();
    }

    function leaveSetupShot(toMatch = false) {
      state.handoffToMatch = false;
      if (!isSetupShot()) return;
      const rw = getRinkWrap();
      if (toMatch) {
        state.lineupMove?.cancel?.(); state.lineupMove = null; $('roster-slots')?.replaceChildren?.();
        if (state.cast) {
          getCancelRaf()?.(state.cast.frame);
          fn('castHome')?.();
          state.cast = null;
        }
        if (state.fieldView) state.fieldView.castHidden = false;
        rw?.classList?.remove?.('cast-away');
        return;
      }
      const back = state.returnShot === 'replay' && !state.theater ? homeShot : state.returnShot;
      setShot(back, { keepPortrait: isMatchShot(back) });
      fn('castTo')?.(false);
      if ($('roster-slots')?.childElementCount) skateLineup(false);
    }

    wideScreen?.addEventListener?.('change', () => {
      if (!isSetupShot()) return;
      getScrollTo()?.(0, 0);
      fitSetupShot();
      state.layoutDirty = true;
      fn('draw')?.();
    });

    const addEvt = getAddEvt();
    addEvt?.('keydown', event => {
      const d = getDoc();
      if (event.key !== 'Escape' || !isSetupShot() || event.defaultPrevented || d?.querySelector?.('dialog:modal, :popover-open')) return;
      cancelSheet();
    });

    function closeLobby() {
      state.lobbyGeneration = (state.lobbyGeneration || 0) + 1;
      if (state.setupFor !== 'lobby') return;
      const toMatch = Boolean(state.online?.state?.game && state.online.state.phase !== 'lobby');
      if ($('roster-dialog')?.dataset?.for === 'lobby') {
        if (toMatch && isSetupShot()) state.handoffToMatch = true;
        closeSheet();
      }
      state.setupFor = 'cpu'; state.lobbyView = null;
      const scrollEl = $('roster-scroll'), lobbyPanel = $('lobby-panel'), dlg = $('roster-dialog');
      if (scrollEl) scrollEl.hidden = false;
      if (lobbyPanel) lobbyPanel.hidden = true;
      dlg?.removeAttribute?.('data-locked');
    }

    const fullscreenTarget = doc?.documentElement ?? null;
    const ownsFullscreenImpl = () => Boolean(fullscreenTarget && getDoc()?.fullscreenElement === fullscreenTarget);
    const ownsFullscreen = rawOverrides.ownsFullscreen ?? ownsFullscreenImpl;

    function syncFullscreenButton() {
      const d = getDoc(), btn = getBtnFullscreen();
      if (!btn) return;
      const owned = Boolean(ownsFullscreen());
      const active = Boolean(d?.fullscreenElement) || Boolean(fullscreenDisplay?.matches);
      d?.body?.classList?.toggle?.('match-fullscreen', isMatchShot() && active);
      getWin()?.ubuPlatform?.setImmersive?.(isMatchShot() && active);
      btn.hidden = !isMatchShot() || Boolean(state.inDiscord) || (!owned && (active || !d?.fullscreenEnabled));
      btn.disabled = Boolean(state.fullscreenRequest);
      const label = owned ? 'Exit fullscreen' : 'Enter fullscreen';
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-pressed', String(owned));
    }

    function updateFullscreenUI() {
      syncFullscreenButton();
      fn('fitScorebug')?.();
      state.layoutDirty = true;
      fn('draw')?.();
    }

    async function exitOwnedFullscreenImpl() {
      if (state.fullscreenRequest) state.fullscreenRequest.leaving = true;
      if (ownsFullscreen()) await getDoc()?.exitFullscreen?.().catch(() => {});
    }
    const exitOwnedFullscreen = rawOverrides.exitOwnedFullscreen ?? exitOwnedFullscreenImpl;

    const btnFullscreenEl = getBtnFullscreen();
    if (btnFullscreenEl) {
      btnFullscreenEl.onclick = async () => {
        if (btnFullscreenEl.hidden || state.fullscreenRequest) return;
        if (ownsFullscreen()) {
          await exitOwnedFullscreen();
          return;
        }
        const request = { leaving: false };
        state.fullscreenRequest = request;
        btnFullscreenEl.disabled = true;
        try {
          await fullscreenTarget.requestFullscreen();
          if (request.leaving) await exitOwnedFullscreen();
        } catch {
        } finally {
          state.fullscreenRequest = null;
          updateFullscreenUI();
        }
      };
    }

    function setPortraitImpl(value) {
      const next = Boolean(value);
      if (Boolean(state.fieldView?.portrait) === next) return;
      state.layoutDirty = true;
      if (state.fieldView) state.fieldView.portrait = next;
      getStadium()?.classList?.toggle?.('portrait-mode', next);
      getWin()?.ubuAudio?.setOrientation?.(next);
      getWin()?.ubuPlatform?.setOrientation?.(next);
      const rot = getBtnRotate();
      if (rot) {
        rot.setAttribute('aria-pressed', String(next));
        rot.title = next ? 'Switch to landscape orientation' : 'Switch to portrait orientation';
        rot.setAttribute('aria-label', next ? 'Switch to landscape orientation' : 'Switch to portrait orientation');
      }
      fn('draw')?.();
    }
    const setPortrait = rawOverrides.setPortrait ?? setPortraitImpl;

    function toggleRotate() {
      setPortrait(!state.fieldView?.portrait);
      try {
        const prefix = portraitScreen?.matches ? 'portrait:' : 'landscape:';
        getStorage()?.setItem?.('ububall-orientation', prefix + (state.fieldView?.portrait ? 'portrait' : 'landscape'));
      } catch {}
    }

    const btnRotateEl = getBtnRotate();
    if (btnRotateEl && !btnRotateEl.onclick) btnRotateEl.onclick = toggleRotate;
    doc?.addEventListener?.('fullscreenchange', updateFullscreenUI);
    fullscreenDisplay?.addEventListener?.('change', updateFullscreenUI);

    function fitOrientation() {
      if (!isMatchShot()) return;
      let want = Boolean(portraitScreen?.matches);
      try {
        const saved = getStorage()?.getItem?.('ububall-orientation') ?? null;
        const prefix = portraitScreen?.matches ? 'portrait:' : 'landscape:';
        if (saved === prefix + 'portrait') want = true;
        else if (saved === prefix + 'landscape') want = false;
      } catch {}
      setPortrait(want);
    }

    const matchInProgress = () => !state.demo && state.phase !== 'over' && Boolean(state.recording && !state.online?.active);

    function updateHome() {
      const active = state.online?.active || matchInProgress();
      const ububallMatch = getMatch();
      const playLbl = $('home-play-label');
      if (playLbl) playLbl.textContent = state.online?.active ? 'Back to online match' : active ? 'Resume match' : 'Quick play';
      const endMatchBtn = $('home-end-match');
      if (endMatchBtn) endMatchBtn.hidden = !active || Boolean(state.online?.spectating);
      const qSetup = $('quick-play-setup');
      if (qSetup) qSetup.hidden = Boolean(active);
      const qSignIn = $('quick-play-signin');
      if (qSignIn) qSignIn.hidden = Boolean(active || fn('signedIn')?.());
      const { mode, level, team } = state.lastCpuSetup || { mode: 'standard', level: 'easy' };
      if (qSetup) {
        const levelLabel = level === 'ballistic' && !state.ballisticAvailable ? 'Choose CPU' : level[0].toUpperCase() + level.slice(1);
        qSetup.textContent = [ububallMatch.modeName(mode), levelLabel,
          team ? 'Last team' : fn('signedIn')?.() ? 'Your team' : 'Guest team'].join(' · ');
      }
    }

    function enterMatch(next = 'match') {
      const l = getLoc(), h = getHistory(), UrlCtor = getURL() ?? URL;
      if (l?.pathname !== '/') return;
      if (state.demo) { fn('stopDemo')?.(); fn('newMatch')?.(true); }
      if (!h?.state?.match && h && UrlCtor) {
        const url = new UrlCtor(l.href || 'https://ububall.com/');
        if (state.online?.spectating) {
          const home = new UrlCtor(url);
          home.searchParams.delete('watch');
          h.replaceState(null, '', home);
        }
        h.pushState({ match: true }, '', url);
      }
      leaveSetupShot(true);
      if (state.lineupMove) { state.lineupMove.cancel(); state.lineupMove = null; }
      $('roster-slots')?.replaceChildren?.();
      if (state.cast) {
        getCancelRaf()?.(state.cast.frame);
        fn('castHome')?.();
        state.cast = null;
      }
      if (state.fieldView) state.fieldView.castHidden = false;
      getRinkWrap()?.classList?.remove?.('cast-away');
      setShot(next);
    }

    function exitMatchMode() {
      closeFirstTurnGuide();
      closeFoulInfo();
      fn('closeSummary')?.();
      fn('stopFanfare')?.();
      fn('gameAudio')?.()?.stopMotion?.();
      if (fn('isExporting')?.()) {
        if (typeof fn('cancelExport') === 'function') fn('cancelExport')();
        else { state.videoCancelled = true; fn('cancelVideo')?.(); }
      }
      state.returnShot = homeShot;
      state.returnPortrait = false;
      closeSheet();
      for (const dialogId of ['match-help', 'pause-menu', 'replays-dialog', 'export-dialog', 'share-dialog']) {
        if ($(dialogId)?.open) $(dialogId).close();
      }
      const drawer = getStatDrawer();
      if (drawer?.matches?.(':popover-open')) drawer.hidePopover();
      fn('endReplay')?.();
      if (!matchInProgress()) state.cpuClient?.dispose?.();
      if (getLoc()?.pathname !== '/') state.demoClient?.dispose?.();
      if (!isHomeShot()) {
        if (state.lineupMove) { state.lineupMove.cancel(); state.lineupMove = null; }
        $('roster-slots')?.replaceChildren?.();
        if (state.cast) {
          getCancelRaf()?.(state.cast.frame);
          fn('castHome')?.();
          state.cast = null;
        }
        if (state.fieldView) state.fieldView.castHidden = false;
        getRinkWrap()?.classList?.remove?.('cast-away');
        setShot(homeShot);
        void exitOwnedFullscreen();
      }
      updateHome();
      state.online?.contextChanged?.();
      if (!matchInProgress() && getLoc()?.pathname === '/') fn('startDemo')?.();
    }

    function openPause() {
      const inReplay = Boolean(state.theater);
      const pm = $('pause-menu');
      if (!pm) return;
      $('pause-title').textContent = inReplay ? 'Replay' : state.online?.spectating ? 'Watching' : state.online?.active ? state.online.state.matchKind === 'online' ? 'Online match' : 'Friend match' : 'CPU match';
      $('pause-resume').textContent = inReplay ? 'Resume replay' : state.online?.spectating ? 'Resume watching' : state.online?.active ? 'Resume match' : 'Resume CPU match';
      $('pause-end-match').hidden = inReplay || state.online?.spectating || !(state.online?.active || matchInProgress());
      $('pause-leave').textContent = inReplay ? 'Exit replay' : state.inDiscord ? 'Back to lobby' : 'Back to home';
      $('pause-restart').disabled = Boolean($('new-match')?.disabled);
      $('pause-restart').hidden = Boolean(state.online?.active);
      if (state.inDiscord) {
        pm.classList.add('has-activity-lobby');
        const pl = $('pause-lobby');
        if (pl) {
          pl.hidden = false;
          pl.append($('activity-play'));
        }
        state.online?.contextChanged?.();
      }
      pm.showModal();
    }

    const pauseMenuEl = $('pause-menu');
    pauseMenuEl?.addEventListener?.('close', () => {
      if (state.inDiscord && !pauseMenuEl.open) getDoc()?.querySelector?.('.play-home')?.prepend?.($('activity-play'));
      state.online?.contextChanged?.();
    });

    function finishCpuMatchImpl() {
      fn('saveRecording')?.();
      fn('clearActiveMatch')?.();
      state.cpuGeneration++;
      state.cpuClient?.cancel?.();
      state.cpuClient?.dispose?.();
      state.draft = [...(state.roster || [])];
      state.phase = 'over';
      state.drag = null;
      closeFirstTurnGuide(); closeFoulInfo(); fn('endGoalReplay')?.(); fn('stopFanfare')?.(); fn('gameAudio')?.()?.stop?.();
    }
    const finishCpuMatch = rawOverrides.finishCpuMatch ?? finishCpuMatchImpl;

    async function leaveForHome(button, endMatch) {
      if (button.disabled) return;
      button.disabled = true;
      try {
        if (state.online?.active) {
          if (!await state.online.leave()) return;
        } else if (endMatch && matchInProgress()) {
          if (!await fn('confirmCpuEnd')?.()) return;
          finishCpuMatch();
        }
        exitMatchMode();
        const h = getHistory();
        if (h?.state?.match) h.back();
        if (!matchInProgress()) fn('startDemo')?.();
      } finally {
        button.disabled = false;
      }
    }

    portraitScreen?.addEventListener?.('change', () => {
      try { getStorage()?.removeItem?.('ububall-orientation'); } catch {}
      getGameUi()?.updateScale?.();
      fitOrientation();
      fn('draw')?.();
    });

    function leavePlayOverlays() {
      closeFirstTurnGuide();
      closeFoulInfo();
      fn('closeSummary')?.();
      fn('stopFanfare')?.();
      fn('gameAudio')?.()?.stopMotion?.();
      if (fn('isExporting')?.()) {
        if (typeof fn('cancelExport') === 'function') fn('cancelExport')();
        else { state.videoCancelled = true; fn('cancelVideo')?.(); }
      }
      state.returnShot = homeShot;
      state.returnPortrait = false;
      state.handoffToMatch = false;
      closeSheet();
      for (const dialogId of ['match-help', 'pause-menu', 'replays-dialog', 'export-dialog', 'share-dialog', 'stats-dialog', 'online-dialog']) {
        if ($(dialogId)?.open) $(dialogId).close();
      }
      const drawer = getStatDrawer();
      if (drawer?.matches?.(':popover-open')) drawer.hidePopover();
      fn('endReplay')?.();
      fn('hideFinger')?.();
      $('field-banner')?.classList?.remove?.('show');
      if (!matchInProgress()) state.cpuClient?.dispose?.();
      state.lineupMove?.cancel?.(); state.lineupMove = null;
      $('roster-slots')?.replaceChildren?.();
    }

    function screenTransition(nextScreen, applyDom, prevScreen) {
      if (!prevScreen || prevScreen === nextScreen) {
        applyDom();
        return;
      }
      const win = getWin(), CustomEventCtor = getCustomEvent();
      if (win?.dispatchEvent && CustomEventCtor) {
        win.dispatchEvent(new CustomEventCtor('ubu:before-screen', { detail: nextScreen }));
      }
      if (nextScreen !== 'play') {
        leavePlayOverlays();
        setShot(nextScreen, { beforeLayout: applyDom });
        void exitOwnedFullscreen();
        fn('castTo')?.(true);
        return;
      }
      setShot(homeShot, { beforeLayout: applyDom });
      const loc = getLoc();
      const openingRoster = Boolean(loc?.search && new URLSearchParams(loc.search).has('roster'));
      const rs = getRinkStage();
      if (openingRoster) return;
      if (rs?.classList?.contains?.('collection-shrinking')) {
        state.afterCollectionShrink = () => { if (isHomeShot()) fn('castTo')?.(false); };
      } else {
        fn('castTo')?.(false);
      }
    }

    const screenGuard = async nextScreen => {
      if (nextScreen === 'play') return true;
      if (state.online?.active && !(await state.online.leave())) return false;
      return true;
    };

    const demoPaused = () => !isHomeShot() || getLoc()?.pathname !== '/' || Boolean(getDoc()?.hidden) || Boolean(state.foulInfo) || Boolean(getDoc()?.querySelector?.('dialog[open]'));

    const ctrl = {
      homeShot,
      isHomeShot,
      isMatchShot,
      isSetupShot,
      playableShot,
      localPlayBlocked,
      demoPaused,
      openFoulInfo,
      closeFoulInfo,
      foulInfoLines,
      updateFoulInfo,
      updateFirstTurnGuide,
      positionFirstTurnGuide,
      animateFirstTurnGuide,
      closeFirstTurnGuide,
      KNOB_SWEEP,
      KNOB_RANGE,
      screenDegrees,
      knobValue,
      knobEditable,
      setKnob,
      aimPower,
      boxPoint,
      screenPoint,
      point,
      fieldTarget,
      measureField,
      stagePoint,
      positionSpinControl: posSpinCtrl,
      stepCollectionLength,
      WIDE_STAGE_QUERY,
      compactPhoneStage,
      settleCameraPromise,
      clearCameraArtifacts,
      cancelActiveCamera,
      finishCameraMove,
      camera,
      setShot,
      endCanvasDrag,
      updateReplaySkip,
      teamHint,
      setupStep,
      wideScreen,
      sheetOpen,
      fitSetupShot,
      skateLineup,
      resetSetupSlots,
      openSheet,
      closeSheet,
      cancelSheet,
      leaveSetupShot,
      closeLobby,
      fullscreenTarget,
      fullscreenDisplay,
      ownsFullscreen,
      syncFullscreenButton,
      updateFullscreenUI,
      exitOwnedFullscreen,
      setPortrait,
      toggleRotate,
      portraitScreen,
      fitOrientation,
      matchInProgress,
      updateHome,
      enterMatch,
      exitMatchMode,
      openPause,
      finishCpuMatch,
      leaveForHome,
      leavePlayOverlays,
      screenTransition,
      screenGuard,
      getShot: () => state.shot,
      getReturnShot: () => state.returnShot,
      getReturnPortrait: () => state.returnPortrait,
      getHandoffToMatch: () => state.handoffToMatch,
      getCameraMove: () => state.cameraMove,
      getSetupFor: () => state.setupFor,
      getOwnsFullscreen: () => ownsFullscreen()
    };

    if (isTestRaw) {
      for (const [k, v] of Object.entries(ctrl)) {
        if (typeof v === 'function' && !PREFER_RAW.includes(k)) raw[k] = v;
        else if (typeof raw[k] === 'undefined') raw[k] = v;
      }
      if (typeof raw.draw === 'function') {
        const prevDraw = raw.draw;
        if (raw.positionSpinControl && !raw._stageDrawWrapped) raw._stageDrawWrapped = true;
      }
    }

    return ctrl;
  }

  function bindMatchHarness(context, { withTheater = false, ububallTheater = null, createEffectsState = null, env = null } = {}) {
    const hadEndReplay = typeof context.endReplay === 'function';
    const hadLoadReplayTurn = typeof context.loadReplayTurn === 'function';
    const state = wrapSessionState(context);
    const stateEndReplay = state.endReplay.bind(state);
    const stateLoadReplayTurn = state.loadReplayTurn.bind(state);
    const exportMethod = (name, impl) => {
      if (typeof context[name] !== 'function') context[name] = impl;
      return context[name];
    };
    const projector = createBodyProjector({
      P: context.P,
      state,
      anonymousName: i => (context.anonymousName ? context.anonymousName(i) : `Ubu ${i + 1}`),
      isClassicMode: () => Boolean(context.classicMode?.()),
      resolveEquippedSuper: (entry, i) => (typeof context.resolveEquippedSuper === 'function' ? context.resolveEquippedSuper(entry, i) : resolveEquippedSuper(context.P, entry, i)),
      getShownSim: () => state.shownSim(),
      getShownSeat: () => state.shownSeat()
    });
    for (const [k, v] of Object.entries({ ...projector, PRESENTATION_KEYS, stripPresentation, onlineOrder, viewIndex, applySeatTransform, transformSimSeat })) {
      exportMethod(k, v);
    }
    exportMethod('viewFouls', (f, seat) => viewFouls(context.ububallMatch, f, seat));
    exportMethod('resolveEquippedSuper', (entry, i = 0) => resolveEquippedSuper(context.P, entry, i));

    const driver = createPlaybackDriver({
      P: context.P,
      ububallMatch: context.ububallMatch,
      clockNow: () => context.clockNow?.() ?? context.performance?.now?.() ?? 0,
      impact: (ms, shake) => context.impact?.(ms, shake),
      creditSave: (body, own, iron) => context.creditSave?.(body, own, iron),
      popup: (body, text) => context.popup?.(body, text),
      getBallView: () => (state.fieldView?.bodies || state.bodies || [])[6],
      traceGuide: (sim, g) => context.traceGuide?.(sim, g),
      recordTrails: () => context.recordTrails?.()
    });
    for (const [k, v] of Object.entries(driver)) exportMethod(k, v);
    context.postGoalState ||= { steps: 0, onTick: null };

    const meterCtrl = createMeterController({ state });
    for (const [k, v] of Object.entries(meterCtrl)) exportMethod(k, v);

    const goalCtrl = createGoalReplayController({ state });
    for (const [k, v] of Object.entries(goalCtrl)) {
      if (k !== 'replayFx') exportMethod(k, v);
    }
    if (!('replayFx' in context)) context.replayFx = goalCtrl.replayFx;

    const lifecycleCtrl = createMatchLifecycleController({ state });
    for (const [k, v] of Object.entries(lifecycleCtrl)) exportMethod(k, v);

    const onlineCtrl = createOnlineMatchController({ state });
    for (const [k, v] of Object.entries(onlineCtrl)) {
      if (k !== 'callbacks') exportMethod(k, v);
    }

    const apiOut = {
      ...projector,
      ...driver,
      ...meterCtrl,
      ...goalCtrl,
      ...lifecycleCtrl,
      ...onlineCtrl,
      onlineCallbacks: onlineCtrl.callbacks,
      PRESENTATION_KEYS,
      stripPresentation,
      onlineOrder,
      viewIndex,
      applySeatTransform,
      transformSimSeat,
      viewFouls: context.viewFouls,
      resolveEquippedSuper: context.resolveEquippedSuper
    };

    if (withTheater) {
      const thMod = ububallTheater ?? root.ububallTheater ?? (typeof require === 'function' ? require('./ububall-theater.js') : null);
      const actionNames = [
        'replayEvents', 'replayHitStop', 'syncReplay', 'makeGuide', 'traceGuide', 'recordTrails',
        'trailPositions', 'clearDiscontinuousTrails', 'emitSkaterEffects', 'updatePopups', 'updateEffects',
        'clearEffects', 'celebrate', 'loopFanfare', 'stopFanfare', 'quench', 'lightNet', 'ballOnFire',
        'popup', 'goalTab', 'replayFileName', 'downloadReplay', 'clockNow', 'gameAudio', 'classicMode',
        'normalStats', 'idlePlan', 'resolveEquippedSuper', 'kickoff', 'buildTeam', 'resetPlans',
        'saveRecording', 'saveActiveMatch', 'stopDemo', 'closeSummary', 'endGoalReplay', 'showMode',
        'enterMatch', 'updateHome', 'say', 'sync', 'draw', 'viewFouls'
      ];
      const actions = {
        getReplayFx: () => context.replayFx ?? goalCtrl.replayFx,
        getThemeColors: () => context.themeColors ?? context.presenter?.getThemeColors?.() ?? {},
        get rinkLogo() { return context.rinkLogo ?? null; },
        setShot: next => {
          if (context._customSetShot) context._customSetShot(next);
          else state.setShot(next, context.document ?? null);
        }
      };
      if (typeof context.setShot === 'function') context._customSetShot = context.setShot;
      for (const name of actionNames) actions[name] = (...a) => context[name]?.(...a);

      const theaterCtrl = thMod.createReplayTheater({
        $: context.$,
        env: env ?? globalThis,
        window: context.window ?? {},
        document: context.document ?? {},
        localStorage: context.localStorage ?? { getItem: () => null, setItem() {} },
        getComputedStyle: context.getComputedStyle ?? (() => ({ fontFamily: 'sans-serif' })),
        P: context.P,
        ubu: context.ubu,
        ububallMatch: context.ububallMatch,
        ububallReplay: context.ububallReplay,
        gameUi: context.gameUi ?? null,
        GOAL_CALL_SECONDS: context.GOAL_CALL_SECONDS ?? 2.4,
        materialStyles: context.materialStyles ?? {},
        createEffectsState: createEffectsState ?? presFallback()?.createEffectsState,
        state,
        playback: {
          onlineOrder,
          viewIndex,
          stripPresentation,
          transformSimSeat,
          viewFouls: (...a) => context.viewFouls(...a),
          runPlaybackTicks: (...a) => context.runPlaybackTicks(...a),
          syncViewBodies: (...a) => context.syncViewBodies(...a)
        },
        onEndReplayState: stateEndReplay,
        onLoadReplayTurnState: stateLoadReplayTurn,
        actions
      });
      theaterCtrl.bindEvents();
      for (const [k, v] of Object.entries(theaterCtrl)) {
        if (typeof v === 'function') {
          if (k === 'endReplay' && !hadEndReplay) context.endReplay = v;
          else if (k === 'loadReplayTurn' && !hadLoadReplayTurn) context.loadReplayTurn = v;
          else exportMethod(k, v);
          apiOut[k] = context[k];
        }
      }
    }

    return apiOut;
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
    wrapSessionState,
    resolveEquippedSuper,
    formatDrawerSuperStatus,
    restoreEntry,
    createBodyProjector,
    createPlaybackDriver,
    createMeterController,
    createPlanClockController,
    stepFrameEffects,
    createFrameLoop,
    createSummaryController,
    createCpuTurnPlanner,
    positionSpinControl,
    createBannerController,
    bindMatchShortcuts,
    bindSpinSlider,
    createDemoFingerController,
    createGoalReplayController,
    createMatchLifecycleController,
    createOnlineMatchController,
    createStageController,
    bindMatchHarness
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ububallPlayback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
