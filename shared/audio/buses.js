/* WebAudio context lifecycle, stereo/mono routing, spatial panning, and loop state. */
'use strict';
let sharedContext = null;
let userUnlocked = false;

function hasUserGesture() {
  if (typeof window === 'undefined') return false;
  return userUnlocked || Boolean(window.navigator?.userActivation?.hasBeenActive);
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    userUnlocked = true;
    if (sharedContext && sharedContext.state === 'suspended') {
      sharedContext.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });
}

let soundVolume = 0.8;
let musicVolume = 0.8;
let audioMode = 'stereo'; // 'stereo' or 'mono'
let currentOrientation = false; // false: landscape, true: portrait

const contextBuses = new WeakMap();
const registeredBusContexts = new Set();

function updateBusMode(masterGain, mode) {
  if (!masterGain) return;
  try {
    if (mode === 'mono') {
      masterGain.channelCount = 1;
      masterGain.channelCountMode = 'explicit';
      masterGain.channelInterpretation = 'speakers';
    } else {
      masterGain.channelCount = 2;
      masterGain.channelCountMode = 'max';
      masterGain.channelInterpretation = 'speakers';
    }
  } catch {}
}

function setupAudioBuses(ctx) {
  if (!ctx) return null;
  if (contextBuses.has(ctx)) return contextBuses.get(ctx);

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(1.0, ctx.currentTime);
  updateBusMode(masterGain, audioMode);
  masterGain.connect(ctx.destination);

  const sfxGain = ctx.createGain();
  sfxGain.gain.setValueAtTime(soundVolume, ctx.currentTime);
  sfxGain.connect(masterGain);

  const musicGain = ctx.createGain();
  musicGain.gain.setValueAtTime(musicVolume, ctx.currentTime);
  musicGain.connect(masterGain);

  const buses = { masterGain, sfxGain, musicGain };
  contextBuses.set(ctx, buses);
  registeredBusContexts.add(ctx);
  return buses;
}

function setSoundVolume(v) {
  soundVolume = Math.max(0, Math.min(1, Number(v) || 0));
  for (const ctx of registeredBusContexts) {
    if (ctx.state === 'closed') { registeredBusContexts.delete(ctx); continue; }
    if (contextBuses.has(ctx)) {
      const buses = contextBuses.get(ctx);
      try {
        buses.sfxGain.gain.cancelScheduledValues(ctx.currentTime);
        buses.sfxGain.gain.setValueAtTime(soundVolume, ctx.currentTime);
      } catch {}
    }
  }
  if (soundVolume === 0) stopMotion();
}

function getSoundVolume() { return soundVolume; }

function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, Number(v) || 0));
  for (const ctx of registeredBusContexts) {
    if (ctx.state === 'closed') { registeredBusContexts.delete(ctx); continue; }
    if (contextBuses.has(ctx)) {
      const buses = contextBuses.get(ctx);
      try {
        buses.musicGain.gain.cancelScheduledValues(ctx.currentTime);
        buses.musicGain.gain.setValueAtTime(musicVolume, ctx.currentTime);
      } catch {}
    }
  }
  if (musicVolume === 0 && activePlayback) {
    activePlayback.stop();
    activePlayback = null;
  }
}

function getMusicVolume() { return musicVolume; }

function setAudioMode(mode) {
  audioMode = mode === 'mono' ? 'mono' : 'stereo';
  for (const ctx of registeredBusContexts) {
    if (ctx.state === 'closed') { registeredBusContexts.delete(ctx); continue; }
    if (contextBuses.has(ctx)) {
      const buses = contextBuses.get(ctx);
      updateBusMode(buses.masterGain, audioMode);
    }
  }
  if (audioMode === 'mono') {
    for (const ctx of activeMotionContexts) {
      const map = motionLoops.get(ctx);
      if (map) {
        for (const entry of map.values()) {
          if (entry.panner) {
            try {
              entry.panner.pan.cancelScheduledValues(ctx.currentTime);
              entry.panner.pan.setValueAtTime(0, ctx.currentTime);
            } catch {}
          }
        }
      }
    }
  }
}

function getAudioMode() { return audioMode; }
function isStereo() { return audioMode === 'stereo'; }

function setOrientation(isPortrait) {
  currentOrientation = Boolean(isPortrait);
}

function isPortrait() { return currentOrientation; }

// Calculates spatial stereo pan in [-0.75, 0.75].
// Landscape: x from 0 (home goal, left) to 1000 (away goal, right).
// Portrait: y from 0 (top boards, left of screen) to 600 (bottom boards, right of screen).
function panFromField(x, y, isPortrait = currentOrientation) {
  if (audioMode === 'mono') return 0;
  let raw = 0;
  if (isPortrait) {
    if (typeof y === 'number' && Number.isFinite(y)) {
      raw = (y - 300) / 300;
    }
  } else {
    if (typeof x === 'number' && Number.isFinite(x)) {
      raw = (x - 500) / 500;
    }
  }
  const clamped = Math.max(-1, Math.min(1, raw));
  return clamped * 0.75;
}

function getPan(options = {}) {
  if (audioMode === 'mono') return 0;
  if (typeof options.pan === 'number' && Number.isFinite(options.pan)) {
    return Math.max(-0.75, Math.min(0.75, options.pan));
  }
  const isP = options.portrait ?? currentOrientation;
  if (typeof options.x === 'number' || typeof options.y === 'number') {
    return panFromField(options.x, options.y, isP);
  }
  return 0;
}

function routePanner(ctx, targetDest, options = {}, cleanup = null) {
  const pan = getPan(options);
  if (pan !== 0 && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, ctx.currentTime);
    panner.connect(targetDest);
    if (cleanup) cleanup.push(panner);
    return panner;
  }
  return targetDest;
}

function getAudioContext(force = false) {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!force && !hasUserGesture()) return null;
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioCtx();
    setupAudioBuses(sharedContext);
  }
  if (sharedContext.state === 'suspended') {
    sharedContext.resume().catch(() => {});
  }
  return sharedContext;
}

// In-game sounds: a gentle high-cut takes the edge off bright transients, and moderate compression
// keeps hits even without squashing them. Given a short sound's length in `seconds`, the chain lets
// go once it has rung out (plus the compressor's release): a chain left connected keeps costing
// the audio graph every block, and a match plays thousands of hits.
// A context can share one chain among its sounds (see shareMasterChain).
const sharedChains = new WeakMap();
function createMasterChain(ctx, cleanup = null, seconds = 0, bus = 'sfx') {
  if (sharedChains.has(ctx)) return sharedChains.get(ctx);
  const soften = ctx.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.setValueAtTime(7500, ctx.currentTime);
  soften.Q.setValueAtTime(0.5, ctx.currentTime);

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-12, ctx.currentTime);
  compressor.knee.setValueAtTime(30, ctx.currentTime);
  compressor.ratio.setValueAtTime(4, ctx.currentTime);
  compressor.attack.setValueAtTime(0.005, ctx.currentTime);
  compressor.release.setValueAtTime(0.25, ctx.currentTime);

  const masterGain = ctx.createGain();
  const buses = contextBuses.get(ctx);
  const targetBus = buses ? (bus === 'music' ? buses.musicGain : buses.sfxGain) : null;
  const initialGain = targetBus ? 0.22 : (0.22 * (bus === 'music' ? musicVolume : soundVolume));
  masterGain.gain.setValueAtTime(initialGain, ctx.currentTime);

  soften.connect(compressor);
  compressor.connect(masterGain);
  if (targetBus) {
    masterGain.connect(targetBus);
  } else {
    masterGain.connect(ctx.destination);
  }
  if (cleanup) cleanup.push(soften, compressor, masterGain);
  if (seconds) {
    const timer = ctx.createConstantSource();
    timer.offset.value = 0; timer.connect(masterGain);
    timer.onended = () => { for (const node of [timer, soften, compressor, masterGain]) node.disconnect(); };
    timer.start(ctx.currentTime); timer.stop(ctx.currentTime + seconds + 0.3);
  }
  return soften;
}

// Sends every later sound on `ctx` through one chain, compressing their mix rather than each sound:
// far cheaper where thousands are rendered at once (a video export), where a chain per sound
// dominated the render.
function shareMasterChain(ctx) {
  sharedChains.delete(ctx);
  sharedChains.set(ctx, createMasterChain(ctx));
}


const superPlayback = new Set();
const magnetTimes = new WeakMap();
function getActivePlayback() { return activePlayback; }
function setActivePlayback(h) { activePlayback = h; }

let activePlayback = null;
const motionLoops = new WeakMap();
const activeMotionContexts = new Set();
const perfNow = () => (typeof performance === 'object' && typeof performance.now === 'function') ? performance.now() : Date.now();
function extendLoopTimer(entry, ms = 220) {
  entry.stopAt = perfNow() + ms;
  if (entry.timer) return;
  const check = () => {
    entry.timer = null;
    if (entry.stopped) return;
    const rem = entry.stopAt - perfNow();
    if (rem > 4) {
      entry.timer = setTimeout(check, Math.ceil(rem));
      entry.timer?.unref?.();
    } else {
      entry.stop();
    }
  };
  entry.timer = setTimeout(check, ms);
  entry.timer?.unref?.();
}

function isOfflineContext(ctx) {
  return (typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext) ||
    ctx?.constructor?.name === 'OfflineAudioContext';
}

function interpRamp(t0, v0, t1, v1, now) {
  if (now <= t0 || t1 <= t0) return now <= t0 ? v0 : v1;
  if (now >= t1) return v1;
  return v0 + (v1 - v0) * ((now - t0) / (t1 - t0));
}

function currentLoopGain(entry, now) {
  if (now <= entry.t0) return entry.g0;
  if (now <= entry.tPeak) {
    const span = entry.tPeak - entry.t0;
    return span > 0 ? entry.g0 + (entry.gPeak - entry.g0) * ((now - entry.t0) / span) : entry.gPeak;
  }
  if (now < entry.tZero) {
    const span = entry.tZero - entry.tPeak;
    return span > 0 ? entry.gPeak * (1 - (now - entry.tPeak) / span) : 0;
  }
  return 0;
}

function stopMotion(customCtx = null) {
  if (customCtx) {
    const map = motionLoops.get(customCtx);
    if (map) for (const entry of [...map.values()]) entry.stop();
    return;
  }
  for (const ctx of [...activeMotionContexts]) {
    const map = motionLoops.get(ctx);
    if (map) for (const entry of [...map.values()]) entry.stop();
    activeMotionContexts.delete(ctx);
  }
}

function stopAll() {
  stopMotion();
  for (const handle of superPlayback) handle.stop();
  if (activePlayback) {
    activePlayback.stop();
    activePlayback = null;
  }
}


module.exports = {
  hasUserGesture, contextBuses, registeredBusContexts, updateBusMode, setupAudioBuses, setSoundVolume, getSoundVolume, setMusicVolume, getMusicVolume, setAudioMode, getAudioMode, isStereo, setOrientation, isPortrait, panFromField, getPan, routePanner, getAudioContext, sharedChains, createMasterChain, shareMasterChain, superPlayback, magnetTimes, getActivePlayback, setActivePlayback, motionLoops, activeMotionContexts, perfNow, extendLoopTimer, isOfflineContext, interpRamp, currentLoopGain, stopMotion, stopAll
};
