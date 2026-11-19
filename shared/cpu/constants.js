/* CPU difficulty presets, evaluation weights, and shared geometry primitives. */
'use strict';
const P = typeof globalThis.ububallPhysics === 'object' && globalThis.ububallPhysics ? globalThis.ububallPhysics : require('../ububall-physics.js');
const M = typeof globalThis.ububallMatch === 'object' && globalThis.ububallMatch ? globalThis.ububallMatch : require('../ububall-match.js');

const HOLD = Object.freeze({ angle: 0, power: 0, spin: 0, superArm: false, guard: false });
const GUARD = Object.freeze({ ...HOLD, guard: true });
const LEVEL_LABELS = Object.freeze({
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  insane: 'Insane',
  god: 'Ububall God'
});
const LEVELS = Object.freeze({
  easy: Object.freeze({ candidates: 14, opponents: 1, searchTicks: 240, wobble: false, risk: .15, temperature: 45 }),
  medium: Object.freeze({ candidates: 48, opponents: 2, searchTicks: 420, wobble: true, risk: .35, temperature: 3.0 }),
  hard: Object.freeze({ candidates: 84, opponents: 3, searchTicks: 500, wobble: true, risk: .53, temperature: 1.5, counterBudget: 13, counterTop: 5, counterRounds: 1, learn: true }),
  insane: Object.freeze({ candidates: 150, opponents: 4, searchTicks: 580, wobble: true, godRefine: true, risk: .55, temperature: .8, counterBudget: 26, counterTop: 8, counterRounds: 1, learn: true, lookaheadTop: 4, lookaheadBreadth: 4, lookaheadTicks: 300, lookaheadBudget: 56, pulseDepth: 2 }),
  god: Object.freeze({ candidates: 240, opponents: 4, searchTicks: 720, wobble: true, godWobble: true, godRefine: true, risk: .55, temperature: .4, counterBudget: 36, counterTop: 10, counterRounds: 2, learn: true, lookaheadTop: 5, lookaheadBreadth: 4, lookaheadTicks: 340, lookaheadBudget: 96, godBridgeDual: true, pulseDepth: 3 })
});
const WEIGHTS = Object.freeze({
  goal: 10000, progress: 1, access: .7, cover: .6, chance: 200, meter: .35,
  role: 8, card: 400, warning: 150, stun: 185, daze: 120
});
const SUPER_RESERVE_BONUS = 28;
const WOBBLE = Object.freeze({ angle: .035, power: .05 });
const COMPLEX = Object.freeze({ simple: 1, creative: .002 });
const ROLE_INTENTS = Object.freeze({
  attack: ['shoot', 'pass', 'carry', 'magnet'],
  support: ['chase', 'clear', 'receive', 'check', 'pass', 'shoot', 'rim', 'draft', 'magnet'],
  defend: ['cover', 'guard', 'hold', 'clear', 'rim', 'magnet']
});
const SEARCH_TICKS = 420;
const TWO_PI = 2 * Math.PI;

const RINK = P?.rink ?? { left: 60, right: 940, top: 60, bottom: 540, corner: 100, goalTop: 230, goalBottom: 370 };
const RINK_LEFT = RINK.left, RINK_RIGHT = RINK.right;
const RINK_TOP = RINK.top, RINK_BOTTOM = RINK.bottom;
const RINK_CX = (RINK_LEFT + RINK_RIGHT) * 0.5;
const RINK_CY = (RINK_TOP + RINK_BOTTOM) * 0.5;
const RINK_SPAN = RINK_RIGHT - RINK_LEFT;
const GOAL_Y_TOP = RINK.goalTop ?? (RINK_CY - 70);
const GOAL_Y_BOT = RINK.goalBottom ?? (RINK_CY + 70);
const SKATER_CURVE = P?.SKATER_CURVE ?? .06, SPIN_DECAY = P?.SPIN_DECAY ?? 5;
const AIR_DRAG = P?.AIR_DRAG ?? 0.00015;
const WALL_RESTITUTION = P?.SURFACES?.wall?.restitution ?? 0.82;
const SHOT_DRIVE = 2400;

function decided(bodies) {
  const ball = bodies[6];
  if (ball.vx || ball.vy || ball.onFire || P.holder(bodies)) return false;
  if (M.cornerOf(P, ball.x, ball.y) !== null) return false;
  if (M.camping(P, bodies, 0) || M.camping(P, bodies, 1)) return false;
  const goalY = (GOAL_Y_TOP + GOAL_Y_BOT) * 0.5;
  const az0 = M.attackZoneLine(P, 0), az1 = M.attackZoneLine(P, 1);
  const baseCut = P.TAILGATE?.frictionCut ?? .4;
  const maxPackCut = P.PACK_DRAFT?.maxCut ?? baseCut;
  const packExp = P.PACK_DRAFT?.exp ?? 0.5;
  for (let i = 0; i < 6; i++) {
    const b = bodies[i];
    if (b.superActive) return false;
    const speed2 = b.vx * b.vx + b.vy * b.vy;
    if (!speed2) continue;
    const speed = Math.sqrt(speed2);
    let maxTeamSyn = 1;
    const tStart = b.team === 0 ? 0 : 3;
    for (let k = tStart; k < tStart + 3; k++) {
      if (k !== i && bodies[k] && !bodies[k].carded && (bodies[k].synergyMult ?? 1) > maxTeamSyn) {
        maxTeamSyn = bodies[k].synergyMult ?? 1;
      }
    }
    const packMult = P.PACK_DRAFT ? (maxTeamSyn * (b.chemistryMult ?? 1)) ** packExp : 1;
    const maxCut = Math.min(maxPackCut, Math.max(baseCut, baseCut * packMult));
    const stopDist = speed2 / (2 * b.friction * (1 - maxCut));
    const contact = Math.max(b.radius, b.reach || b.radius, 18) + ball.radius;
    const ballReach = stopDist + contact;
    const dbx = b.x - ball.x, dby = b.y - ball.y, db2 = dbx * dbx + dby * dby;
    if (db2 <= (ballReach + 1e-4) * (ballReach + 1e-4)) {
      if (db2 < (ballReach - 1e-4) * (ballReach - 1e-4) || Math.hypot(dbx, dby) - contact <= stopDist) return false;
    }
    const ownGoalX = b.team ? RINK_RIGHT : RINK_LEFT;
    const creaseReach = stopDist + M.FOULS.crease;
    const dgx = b.x - ownGoalX, dgy = b.y - goalY, dg2 = dgx * dgx + dgy * dgy;
    if (dg2 <= (creaseReach + 1e-4) * (creaseReach + 1e-4)) {
      if (dg2 < (creaseReach - 1e-4) * (creaseReach - 1e-4) || Math.hypot(dgx, dgy) - M.FOULS.crease <= stopDist) return false;
    }
    const stopX = b.x + (b.vx / speed) * stopDist;
    const oppAz = b.team ? az0 : az1;
    if ((b.x - oppAz) * (stopX - oppAz) <= 0) return false;
    const oStart = b.team === 0 ? 3 : 0;
    for (let j = oStart; j < oStart + 3; j++) {
      const o = bodies[j];
      if (o.carded) continue;
      const dx = o.x - b.x, dy = o.y - b.y;
      if (dx * b.vx + dy * b.vy <= 0) continue;
      const oppReach = stopDist + b.radius + o.radius;
      const do2 = dx * dx + dy * dy;
      if (do2 <= (oppReach + 1e-4) * (oppReach + 1e-4)) {
        if (do2 < (oppReach - 1e-4) * (oppReach - 1e-4) || Math.hypot(dx, dy) - b.radius - o.radius <= stopDist) return false;
      }
    }
  }
  return true;
}

function randomSource(seed = 1) {
  let value = seed >>> 0;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const contactRadius = b => Math.max(b.radius, b.reach || b.radius, 18);

function skaterDrive(body, superKey = null, spin = 0) {
  const superScale = superKey === 'colossus' && body.superActive !== 'colossus'
    ? (P.SUPER.colossusLaunch ?? (1 / P.SUPER.colossusMass))
    : (superKey === 'stalwart' && body.superActive !== 'stalwart' ? (P.SUPER.stalwartLaunch ?? 0.5) : 1);
  const carveBoost = spin && P.carveDriveBoost ? P.carveDriveBoost(body, spin) : 1;
  const maxV = P.launchSpeed(body) * superScale * carveBoost;
  const frictionMult = (superKey === 'stalwart' || body.superActive === 'stalwart')
    ? (P.SUPER.stalwartFriction ?? 3)
    : (body.holding ? (P.SUPER.carryFriction ?? 1.5) : 1);
  return { maxV, effFriction: body.friction * frictionMult };
}

function segmentBlocked(ax, ay, bx, by, obstacles, clearance = 38) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  if (len2 < 1) return null;
  let best = null, bestT = 2;
  for (let i = 0; i < obstacles.length; i++) {
    const ob = obstacles[i];
    const t = Math.max(0, Math.min(1, ((ob.x - ax) * dx + (ob.y - ay) * dy) / len2));
    if (t <= 0.05 || t >= 0.98) continue;
    const px = ax + t * dx, py = ay + t * dy;
    const dist = Math.hypot(ob.x - px, ob.y - py);
    if (dist < (ob.radius || 25) + clearance && t < bestT) {
      bestT = t;
      best = { body: ob, dist, side: (dx * (ob.y - ay) - dy * (ob.x - ax)) >= 0 ? 1 : -1 };
    }
  }
  return best;
}


const creativityOf = body => (body.personality?.creativity ?? 31.5) / 63;
function behindBall(body, ball, team) {
  return team === 0 ? body.x <= ball.x + 12 : body.x >= ball.x - 12;
}
function isPointBlank(body, ball) {
  const reach = Math.max(body.radius, bReach(body), 18);
  return Math.hypot(body.x - ball.x, body.y - ball.y) - reach - ball.radius < 4 * ball.radius;
}
function bReach(body) { return body.reach || body.radius; }

const INTENT = Symbol('intent');
const MOVE_ID = Symbol('moveId');
function tag(move, intent) {
  return {
    angle: move.angle, power: move.power, spin: move.spin,
    superArm: move.superArm, guard: move.guard, [INTENT]: intent
  };
}
function getIntent(move) { return move ? move[INTENT] : undefined; }
function copy(move) {
  return {
    angle: move.angle, power: move.power, spin: move.spin,
    superArm: move.superArm, guard: move.guard, [INTENT]: move[INTENT]
  };
}
function fitsRole(job, move, body, state) {
  const intent = getIntent(move);
  if (ROLE_INTENTS[job]?.includes(intent)) return true;
  if (job === 'attack' && intent === 'check') {
    const sKey = body?.equippedSuper?.key?.toLowerCase();
    const carrier = state?.bodies && P.holder(state.bodies);
    const opponentHasBall = carrier && carrier.team >= 0 && carrier.team !== body?.team;
    if (opponentHasBall) return true;
    if (move.superArm && (sKey === 'knockout' || sKey === 'shockwave')) return true;
  }
  return false;
}


function roles(state, team) {
  const ball = state.bodies[6], body = i => state.bodies[team * 3 + i];
  const active = [0, 1, 2].filter(i => !body(i).carded && !body(i).stunned);
  const defPool = active.length ? active : [0, 1, 2];
  const nearest = (list, x, y) => list.reduce((a, b) => Math.hypot(body(b).x - x, body(b).y - y) < Math.hypot(body(a).x - x, body(a).y - y) ? b : a);
  const defender = nearest(defPool, team ? RINK_RIGHT : RINK_LEFT, RINK_CY);
  const restActive = active.filter(i => i !== defender);
  const rest = restActive.length ? restActive : [0, 1, 2].filter(i => i !== defender);
  const attacker = nearest(rest, ball.x, ball.y);
  return [0, 1, 2].map(i => i === defender ? 'defend' : i === attacker ? 'attack' : 'support');
}

module.exports = {
  roles,
  P, M, HOLD, GUARD, LEVEL_LABELS, LEVELS, WEIGHTS, SUPER_RESERVE_BONUS, WOBBLE, COMPLEX, ROLE_INTENTS, SEARCH_TICKS, TWO_PI, RINK, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CX, RINK_CY, RINK_SPAN, GOAL_Y_TOP, GOAL_Y_BOT, SKATER_CURVE, SPIN_DECAY, AIR_DRAG, WALL_RESTITUTION, SHOT_DRIVE, decided, randomSource, contactRadius, skaterDrive, segmentBlocked, creativityOf, behindBall, isPointBlank, bReach, INTENT, MOVE_ID, tag, getIntent, copy, fitsRole
};
