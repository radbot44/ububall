'use strict';
/* Deterministic, bounded team search. Uses the same turn resolver as matches. */
const {
  LEVELS, LEVEL_LABELS, WEIGHTS, WOBBLE, COMPLEX, SEARCH_TICKS, HOLD, GUARD,
  decided, randomSource, segmentBlocked, behindBall, isPointBlank
} = require('./cpu/constants.js');
const { cpuPlans, legacy } = require('./cpu/baseline.js');
const { aim, traceMovingBall, strike } = require('./cpu/kinematics.js');
const {
  shotConePoint, goalPocketPoint, canOccupyCrease, traceIncomingShot,
  guardCoversSegment, assessOpponentThreat, scanGoalAperture
} = require('./cpu/threat.js');
const { options, jointTeamPlays } = require('./cpu/candidates.js');
const { FEATURE_NAMES, evaluate, features } = require('./cpu/evaluate.js');
const { learnedOpponentResponse, learnedOpponentResponses } = require('./cpu/opponent.js');
const { plan } = require('./cpu/search.js');

const baseline = cpuPlans;
const api = Object.freeze({
  LEVELS, LEVEL_LABELS, WEIGHTS, WOBBLE, COMPLEX, SEARCH_TICKS, HOLD, GUARD,
  randomSource, legacy, decided, plan, aim, strike, behindBall, isPointBlank,
  evaluate, features, FEATURE_NAMES, options, segmentBlocked, cpuPlans, baseline,
  shotConePoint, goalPocketPoint, canOccupyCrease, traceIncomingShot, traceMovingBall,
  guardCoversSegment, assessOpponentThreat, scanGoalAperture, jointTeamPlays,
  learnedOpponentResponse, learnedOpponentResponses
});

if (typeof globalThis !== 'undefined') globalThis.ububallCPU = api;
if (typeof module === 'object' && module.exports) module.exports = api;
