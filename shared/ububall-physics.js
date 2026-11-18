'use strict';
/* Deterministic 240 Hz rigid-body & spin rink physics. See docs/ububall.md. */
const {
  VERSION, rink, DT, BASE_LAUNCH_SPEED, IMPULSE, SKATER_CURVE, BASE_MAX_SPIN, SPIN_DECAY,
  SETTLED_SPIN_DECAY, AIR_DRAG, STRIKE_GAIN, CLOSE_SPIN_GAIN, STRIKE_POWER, STRIKE_MIN_SPEED,
  SPIN_STRIKE_MIN_OMEGA, SURFACES, SUPERS, DAZE, SIZE, ICE_BITE, CARVE_DRIVE, TRUE_GLIDE,
  TEMPERED_SHOT, SWEET_SPOT, BOARD_SPRING, TAPE_TO_TAPE, PACK_DRAFT, SUPER, HEAT, FIRE_TICKS,
  IRON_COOLDOWN_TICKS, SNAP, RIM, TAILGATE, HIP_CLIP, tailgateFactor, carveDriveBoost,
  ballOnFire, ballCurveFactor, holder, dazeSlow, multiplier, launchSpeed, syncEffectiveStats,
  applyStats, spawn, makeUbu, makeBall, setStriker, clearStriker, clearHeat, kickoff, superMastery
} = require('./physics/constants.js');
const { applyDoubledGuard, endSuper, triggerShockwave, triggerIronShockwave } = require('./physics/collide.js');
const { step } = require('./physics/step.js');
const { launch, settled, stop, stepPostGoal, ballRun, wouldScore, startTurn, predictTurn } = require('./physics/turn.js');

const api = Object.freeze({
  VERSION, rink, DT, BASE_LAUNCH_SPEED, IMPULSE, SKATER_CURVE, BASE_MAX_SPIN, SPIN_DECAY, SETTLED_SPIN_DECAY, AIR_DRAG,
  STRIKE_GAIN, CLOSE_SPIN_GAIN, STRIKE_POWER, STRIKE_MIN_SPEED, SPIN_STRIKE_MIN_OMEGA, SURFACES, SUPERS, DAZE, SIZE,
  ICE_BITE, CARVE_DRIVE, TRUE_GLIDE, TEMPERED_SHOT, SWEET_SPOT, BOARD_SPRING, TAPE_TO_TAPE, PACK_DRAFT, SUPER, HEAT,
  FIRE_TICKS, IRON_COOLDOWN_TICKS, SNAP, RIM, TAILGATE, HIP_CLIP, tailgateFactor, carveDriveBoost, ballOnFire,
  ballCurveFactor, holder, dazeSlow, multiplier, launchSpeed, syncEffectiveStats, applyStats, applyDoubledGuard,
  spawn, makeUbu, makeBall, setStriker, clearStriker, clearHeat, kickoff, endSuper, superMastery, step, stepPostGoal,
  launch, settled, stop, ballRun, wouldScore, triggerShockwave, triggerIronShockwave, startTurn, predictTurn
});

if (typeof globalThis !== 'undefined') globalThis.ububallPhysics = api;
if (typeof module === 'object' && module.exports) module.exports = api;
