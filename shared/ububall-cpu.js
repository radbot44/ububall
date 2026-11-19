'use strict';
/* Deterministic, bounded team search + optional UBNN neural value/policy inference. */
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
const {
  NN_MAGIC, NN_FORMAT, NN_INPUT_DIM, NN_HIDDEN_DIM, NN_VALUE_DIM, NN_POLICY_DIM, NN_ROW_FLOATS,
  Y_FLIP_OBS_INDICES, Y_FLIP_POL_INDICES,
  encodeObservation, encodeState, encodePlans, decodePolicyPlans,
  parseWeights, loadWeights, clearWeights, hasWeights, forward
} = require('./cpu/nn.js');
const { plan } = require('./cpu/search.js');

const baseline = cpuPlans;
const api = Object.freeze({
  LEVELS, LEVEL_LABELS, WEIGHTS, WOBBLE, COMPLEX, SEARCH_TICKS, HOLD, GUARD,
  NN_MAGIC, NN_FORMAT, NN_INPUT_DIM, NN_HIDDEN_DIM, NN_VALUE_DIM, NN_POLICY_DIM, NN_ROW_FLOATS,
  Y_FLIP_OBS_INDICES, Y_FLIP_POL_INDICES,
  randomSource, legacy, decided, plan, aim, strike, behindBall, isPointBlank,
  evaluate, features, FEATURE_NAMES, options, segmentBlocked, cpuPlans, baseline,
  shotConePoint, goalPocketPoint, canOccupyCrease, traceIncomingShot, traceMovingBall,
  guardCoversSegment, assessOpponentThreat, scanGoalAperture, jointTeamPlays,
  learnedOpponentResponse, learnedOpponentResponses,
  encodeObservation, encodeState, encodePlans, decodePolicyPlans,
  parseWeights, loadWeights, clearWeights, hasWeights, forward
});

if (typeof globalThis !== 'undefined') globalThis.ububallCPU = api;
if (typeof module === 'object' && module.exports) module.exports = api;
