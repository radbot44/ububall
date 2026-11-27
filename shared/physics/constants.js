'use strict';
// Bump VERSION with any change to how a turn plays out (startTurn, step and their tuning): saved
// replays re-simulate their turns and refuse a different version (docs/ububall-file.md).
const VERSION = 31;
const rink = Object.freeze({ left: 60, right: 940, top: 60, bottom: 540, corner: 100, goalTop: 230, goalBottom: 370, goalDepth: 38 });
const DT = 1 / 240, SUBSTEPS = 16, BASE_LAUNCH_SPEED = 720;
const IRON_COOLDOWN_TICKS = 48; // ~200 ms at 240 Hz DT: cooldown after an Iron Save
const IMPULSE = 3 * BASE_LAUNCH_SPEED;
const SKATER_CURVE = .06, BALL_CURVE = .06, BURNING_BALL_CURVE = .08;
const AIR_DRAG = .00015; // Quadratic drag on the ball, strongest on fast shots; ubus have none.
const BASE_MAX_SPIN = 20;
const SPIN_DECAY = 5, SETTLED_SPIN_DECAY = 30; // Rad/s of spin every body loses each second (faster once linear motion settles).
const STRIKE_GAIN = 1, CLOSE_SPIN_GAIN = 2; // Spin strike multiplier from range and at point blank.
const STRIKE_POWER = .5; // Point-blank strike's extra ball speed, as a share of the ubu's speed.
const SPIN_STRIKE_MIN_OMEGA = 10; // Rad/s required at contact to upgrade a point-blank strike into a Spin Strike.
const GUARD_BRAKE = .25; // Share of velocity and spin a guarding ubu keeps when its turn starts.
const SURFACES = Object.freeze({
  wall: { restitution: .82, ubuRestitutionCap: .95, gripScale: 1, spinKeep: .5, meteorBank: true },
  post: { restitution: .96, ubuRestitutionCap: 1, gripScale: 1.45, spinKeep: 1, meteorBank: true },
  net: { restitution: .60, ubuRestitutionCap: .95, gripScale: 1, spinKeep: .5, meteorBank: false },
});
// Size trade-offs (tuning): as powers of the size multiplier, small ubus launch faster, curve and
// re-steer more and strike spin harder; big ubus lose more speed off the boards.
const SIZE = Object.freeze({ launch: -.16, agility: -.45, strike: -.5, boards: -.4 });
// Stat-balance mechanics (v28): Ice Bite, Carve Drive, True Glide, Tempered Shot, Sweet Spot,
// Wide Stance, Board Spring, Tape-to-Tape, and Pack Draft.
const ICE_BITE = Object.freeze({ impulseExp: .55, gripLaunchExp: .18, gripCutExp: .35 });
const CARVE_DRIVE = Object.freeze({ boost: .20, threshold: 1 });
const TRUE_GLIDE = Object.freeze({ involuntaryCurve: .55 });
const TEMPERED_SHOT = Object.freeze({ powerExp: .75, firePowerExp: .5 });
const SWEET_SPOT = Object.freeze({ pokeTipMin: .86 });
const BOARD_SPRING = Object.freeze({ wallUbuRestitution: .66, rimRedirect: .45 });
const TAPE_TO_TAPE = Object.freeze({ snapExp: .75, minPassSpeed: 140 });
const PACK_DRAFT = Object.freeze({ exp: .5, maxCut: .65 });
// Heat and fire tuning, as shares of BASE_LAUNCH_SPEED.
const HEAT = Object.freeze({ orange: 540 / BASE_LAUNCH_SPEED, red: 720 / BASE_LAUNCH_SPEED, redHot: 800 / BASE_LAUNCH_SPEED, fire: 840 / BASE_LAUNCH_SPEED, sustain: .70 });
const FIRE_TICKS = 60;
const IRON_KEEP = .1;
const HOT_DRIVE = Object.freeze({ min: 60, max: 140 });
const SNAP = Object.freeze({ minPassSpeed: 180, minDrive: 140, redirect: .35, heatTicks: 30 });
const STRIKE_MIN_SPEED = SNAP.minPassSpeed;
const RIM = Object.freeze({ maxNormal: 190, minTangent: 150, bounceScale: .35, spinKeep: .92, checkGrip: 1.25 });
const TAILGATE = Object.freeze({ minLeadSpeed: 240, minSpeed: 110, maxGap: 95, minAlign: .80, frictionCut: .40 });
const HIP_CLIP = Object.freeze({ minRelSpeed: 210, glanceRatio: 1.05, gripBoost: .55 });

const TAILGATE_MIN_LEAD2 = TAILGATE.minLeadSpeed * TAILGATE.minLeadSpeed - 1e-6;
const TAILGATE_MIN_FOLLOW2 = TAILGATE.minSpeed * TAILGATE.minSpeed - 1e-6;
const TAILGATE_SPAN = 1 - TAILGATE.minAlign;
const PACK_MAX_FACTOR = PACK_DRAFT.maxCut / TAILGATE.frictionCut;

function bodyKE(b) {
  return .5 * b.mass * (b.vx * b.vx + b.vy * b.vy) + .25 * b.mass * b.radius * b.radius * b.omega * b.omega;
}

const scratchV2 = new Float64Array(8);
const scratchSpeed = new Float64Array(8);

function skaterDraftAt(bodies, skaterCount, idx, b) {
  let speed = scratchSpeed[idx];
  let maxDraft = 0;
  const bvx = b.vx, bvy = b.vy, bx = b.x, by = b.y, br = b.radius;
  const bTeam = b.team, bChem = b.chemistryMult ?? 1;
  for (let j = 0; j < skaterCount; j++) {
    if (j === idx) continue;
    if (scratchV2[j] < TAILGATE_MIN_LEAD2) continue;
    const lead = bodies[j];
    if (lead.carded) continue;
    const lvx = lead.vx, lvy = lead.vy;
    const headingDot = bvx * lvx + bvy * lvy;
    if (headingDot <= 0) continue;
    const dx = lead.x - bx, dy = lead.y - by;
    const aheadDot = dx * lvx + dy * lvy;
    if (aheadDot <= 0) continue;
    const lr = lead.radius;
    const effectiveMaxGap = TAILGATE.maxGap * Math.max(1, lr / 25);
    const maxDist = effectiveMaxGap + lr + br;
    if (dx >= maxDist || dx <= -maxDist || dy >= maxDist || dy <= -maxDist) continue;
    let leadSpeed = scratchSpeed[j];
    if (leadSpeed === 0) {
      leadSpeed = Math.hypot(lvx, lvy);
      scratchSpeed[j] = leadSpeed;
    }
    if (leadSpeed < TAILGATE.minLeadSpeed) continue;
    const d = Math.hypot(dx, dy);
    if (d <= 0) continue;
    const gap = d - lr - br;
    if (gap >= effectiveMaxGap) continue;
    const ahead = Math.min(1, aheadDot / (d * leadSpeed));
    if (ahead < TAILGATE.minAlign) continue;
    if (speed === 0) {
      speed = Math.hypot(bvx, bvy);
      scratchSpeed[idx] = speed;
      if (speed < TAILGATE.minSpeed) return 0;
    }
    const heading = Math.min(1, headingDot / (speed * leadSpeed));
    if (heading < TAILGATE.minAlign) continue;
    const rawDraft = (1 - gap / effectiveMaxGap) * ((ahead - TAILGATE.minAlign) / TAILGATE_SPAN) * ((heading - TAILGATE.minAlign) / TAILGATE_SPAN);
    const sameTeam = lead.team === bTeam;
    const teamBoost = sameTeam
      ? (((lead.synergyMult ?? 1) * bChem) ** PACK_DRAFT.exp)
      : 1;
    const maxFactor = sameTeam ? PACK_MAX_FACTOR : 1;
    const draft = Math.min(maxFactor, Math.max(0, rawDraft * teamBoost));
    if (draft > maxDraft) maxDraft = draft;
  }
  return maxDraft;
}

function tailgateFactor(bodies, b) {
  if (!b || b.team < 0 || b.carded || !Array.isArray(bodies)) return 0;
  const speed2 = b.vx * b.vx + b.vy * b.vy;
  if (speed2 < TAILGATE_MIN_FOLLOW2) return 0;
  let speed = 0;
  let maxDraft = 0;
  const limit = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
  for (let j = 0; j < limit; j++) {
    const lead = bodies[j];
    if (!lead || lead === b || lead.team < 0 || lead.carded) continue;
    if (lead.vx * lead.vx + lead.vy * lead.vy < TAILGATE_MIN_LEAD2) continue;
    const headingDot = b.vx * lead.vx + b.vy * lead.vy;
    if (headingDot <= 0) continue;
    const dx = lead.x - b.x, dy = lead.y - b.y;
    const aheadDot = dx * lead.vx + dy * lead.vy;
    if (aheadDot <= 0) continue;
    const effectiveMaxGap = TAILGATE.maxGap * Math.max(1, lead.radius / 25);
    const maxDist = effectiveMaxGap + lead.radius + b.radius;
    if (dx >= maxDist || dx <= -maxDist || dy >= maxDist || dy <= -maxDist) continue;
    const leadSpeed = Math.hypot(lead.vx, lead.vy);
    if (leadSpeed < TAILGATE.minLeadSpeed) continue;
    const d = Math.hypot(dx, dy);
    if (d <= 0) continue;
    const gap = d - lead.radius - b.radius;
    if (gap >= effectiveMaxGap) continue;
    const ahead = Math.min(1, aheadDot / (d * leadSpeed));
    if (ahead < TAILGATE.minAlign) continue;
    if (!speed) {
      speed = Math.hypot(b.vx, b.vy);
      if (speed < TAILGATE.minSpeed) return 0;
    }
    const heading = Math.min(1, headingDot / (speed * leadSpeed));
    if (heading < TAILGATE.minAlign) continue;
    const rawDraft = (1 - gap / effectiveMaxGap) * ((ahead - TAILGATE.minAlign) / TAILGATE_SPAN) * ((heading - TAILGATE.minAlign) / TAILGATE_SPAN);
    const teamBoost = lead.team === b.team
      ? (((lead.synergyMult ?? 1) * (b.chemistryMult ?? 1)) ** PACK_DRAFT.exp)
      : 1;
    const maxFactor = lead.team === b.team ? PACK_MAX_FACTOR : 1;
    const draft = Math.min(maxFactor, Math.max(0, rawDraft * teamBoost));
    if (draft > maxDraft) maxDraft = draft;
  }
  return maxDraft;
}

function ballOnFire(ball) {
  return Boolean(ball?.onFire);
}
function ballCurveFactor(ball, burning = ballOnFire(ball)) {
  return (burning ? BURNING_BALL_CURVE : BALL_CURVE) * (ball.curveMult ?? 1);
}
// A slowing that counts against the pace takes the same share off it.
function countSlowing(ball, before) {
  const after = Math.hypot(ball.vx, ball.vy);
  if (after < before) ball.pace = (ball.pace || 0) * after / before;
}
const DAZE = Object.freeze({ speed: 250, scale: 2850, hit: .2, free: .15, max: .4 });
function daze(body, knock) {
  if (body.superActive !== 'stalwart' && knock > DAZE.speed) body.daze = Math.min(DAZE.max, (body.daze || 0) + Math.min(DAZE.hit, (knock - DAZE.speed) / DAZE.scale / (body.stability || 1)));
}
function dazeSlow(body) {
  const d = body.daze || 0;
  return d <= DAZE.free ? 0 : (d - DAZE.free) / (DAZE.max - DAZE.free) * DAZE.max;
}
const SUPER = Object.freeze({ ticks: 720, holdTicks: 480, carryFriction: 1.5, magnetRadius: 190, magnetPull: 1000,
  shockRadius: 170, shockForce: 1100, shockTeammate: .4, shockRepel: 550, cannonball: 1,
  colossusRadius: 25 * 1.5 * 1.5, colossusMass: 3 * Math.sqrt(1.5) * 1.5, colossusGrowTicks: 40, colossusLaunch: 0.75,
  stalwartLaunch: 0.5, stalwartFriction: 3.0, whiffRefund: 25 });
function ballHitRadius(body) {
  if (body.team < 0) return body.radius >= 18 ? body.radius : 18;
  const r = body.radius, rc = body.reach || r;
  const m = r >= rc ? r : rc;
  return m >= 18 ? m : 18;
}
const SUPERS = Object.freeze([
  { id: 0, key: 'stalwart', name: 'Stalwart', desc: 'Slide to an unmovable anchor, immune to dazes, checks, blasts and goal camping.', icon: 'assets/00_stalwart.png' },
  { id: 1, key: 'knockout', name: 'Knockout', desc: 'Knock out the next opponent touched; they cannot move next turn.', icon: 'assets/01_knockout.png' },
  { id: 2, key: 'sticky', name: 'Sticky', desc: 'Grab the ball on contact and carry it for up to 2 seconds, until an opponent hits you.', icon: 'assets/02_sticky.png' },
  { id: 3, key: 'cannonball', name: 'Cannonball', desc: 'Blast the ball with explosive impulse on contact.', icon: 'assets/03_cannonball.png' },
  { id: 4, key: 'magnet', name: 'Magnet', desc: 'Pull the ball strongly toward you for 3 seconds when it comes close.', icon: 'assets/04_magnet.png' },
  { id: 5, key: 'colossus', name: 'Colossus', desc: 'Swell in size and mass for massive coverage, moving slower while big.', icon: 'assets/05_colossus.png' },
  { id: 6, key: 'shockwave', name: 'Shockwave', desc: 'Blast nearby opponents away when one comes close, then repel opposing skaters for the rest of the 3 seconds.', icon: 'assets/06_shockwave.png' },
  { id: 7, key: 'ghost', name: 'Ghost', desc: 'Phase through opposing players without collision.', icon: 'assets/07_ghost.png' }
]);
function superMastery(supers, superId) {
  if (superId == null) return { level: 1, copies: 1, suffix: '', displayName: '', bonusTicks: 0, bonusRefund: 0 };
  const copies = Array.isArray(supers) ? supers.filter(s => (s % 8) === superId).length : 1;
  const base = SUPERS[superId] || { name: 'Super' };
  if (copies >= 4) return { level: 4, copies, suffix: ' Master', displayName: base.name + ' Master', bonusTicks: 480, bonusRefund: 20 };
  if (copies === 3) return { level: 3, copies, suffix: ' III', displayName: base.name + ' III', bonusTicks: 240, bonusRefund: 10 };
  if (copies === 2) return { level: 2, copies, suffix: ' II', displayName: base.name + ' II', bonusTicks: 120, bonusRefund: 5 };
  return { level: 1, copies: Math.max(1, copies), suffix: '', displayName: base.name, bonusTicks: 0, bonusRefund: 0 };
}

const MULT_TABLE = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  MULT_TABLE[i] = i < 127 ? (2 / 3) ** ((127 - i) / 127) : 1.5 ** ((i - 127) / 128);
}
function multiplier(raw) {
  if (!Number.isInteger(raw) || raw < 0 || raw > 255) throw new RangeError('Stat must be an integer from 0 to 255.');
  return MULT_TABLE[raw];
}

function carveDriveBoost(body, spin = 0) {
  const absSpin = Math.min(1, Math.abs(spin || 0));
  if (!absSpin || !body) return 1;
  const spinMult = (body.maxSpin ?? BASE_MAX_SPIN) / BASE_MAX_SPIN;
  const sc = Math.sqrt(spinMult * (body.curveMult ?? 1));
  return sc > CARVE_DRIVE.threshold ? 1 + CARVE_DRIVE.boost * absSpin * (sc - CARVE_DRIVE.threshold) : 1;
}
function launchSpeed(body) {
  const isColossus = body.superActive === 'colossus';
  const superScale = isColossus ? SUPER.colossusLaunch
    : (body.superActive === 'stalwart' ? SUPER.stalwartLaunch
    : (body.baseMass || body.mass) / body.mass);
  return (body.impulse || IMPULSE) / 3 * superScale * (body.sizeMult || 1) ** SIZE.launch * (1 - dazeSlow(body));
}
function colossusProgress(b) {
  if (b.superActive !== 'colossus') return 0;
  if (!b.superTicks) return 1;
  const totalTicks = SUPER.ticks + (b.equippedSuper?.bonusTicks ?? b.superBonusTicks ?? 0);
  const elapsed = Math.max(0, totalTicks - b.superTicks);
  return Math.min(1, elapsed / SUPER.colossusGrowTicks);
}
function syncEffectiveStats(b) {
  if (b.team < 0) return;
  const baseR = b.baseRadius ?? b.radius;
  const baseM = b.baseMass ?? b.mass;
  if (b.superActive === 'colossus') {
    const p = colossusProgress(b);
    b.radius = p > 0 ? baseR + (Math.max(baseR, SUPER.colossusRadius) - baseR) * p : baseR;
    b.mass = p > 0 ? baseM + (Math.max(baseM, SUPER.colossusMass) - baseM) * p : baseM;
  } else {
    b.radius = baseR;
    b.mass = baseM;
  }

  if (b.guarding) {
    const mult = b.ironGuard ? 1.5 : 1.25;
    const guardCap = Math.max(37.5, baseR * mult);
    b.reach = Math.max(b.radius, Math.min(guardCap, (b.baseReach || b.radius) * mult));
    b.friction = Math.min(b.ironGuard ? 270 : 225, (b.baseFriction || 150) * mult);
    b.strength = Math.min(b.ironGuard ? 2.0 : 1.5, (b.baseStrength || 1) * mult);
    b.stability = Math.min(b.ironGuard ? 2.0 : 1.5, (b.baseStability || 1) * mult);
    b.bounciness = b.ironGuard ? Math.max(0.4, (b.baseBounciness || 1) * 0.5) : Math.max(2 / 3, (b.baseBounciness || 1) * 0.75);
  } else {
    b.reach = b.baseReach ?? b.radius;
    b.friction = b.baseFriction ?? 150;
    b.strength = b.baseStrength ?? 1;
    b.stability = b.baseStability ?? 1;
    b.bounciness = b.baseBounciness ?? 1;
  }
}
function applyStats(body, raw = {}) {
  body.sizeMult = multiplier(raw.size ?? 127);
  body.baseMass = 3 * Math.sqrt(multiplier(raw.mass ?? 127));
  body.baseRadius = 25 * body.sizeMult;
  body.baseFriction = 150 * multiplier(raw.traction ?? 127) ** .7;
  body.maxSpin = BASE_MAX_SPIN * multiplier(raw.spin ?? 127);
  const gripMult = multiplier(raw.grip ?? 127);
  body.grip = .3 * gripMult;
  body.impulse = IMPULSE * multiplier(raw.impulse ?? 127) ** ICE_BITE.impulseExp * gripMult ** ICE_BITE.gripLaunchExp;
  body.curveMult = multiplier(raw.curve ?? 127);
  body.curveFactor = SKATER_CURVE * body.curveMult * body.sizeMult ** SIZE.agility;
  body.baseBounciness = multiplier(raw.bounciness ?? 127);
  body.power = multiplier(raw.power ?? 127) ** TEMPERED_SHOT.powerExp;
  body.baseReach = Math.max(body.baseRadius, 25 * multiplier(raw.reach ?? 127), 18);
  body.baseStrength = multiplier(raw.strength ?? 127);
  body.baseStability = multiplier(raw.stability ?? 127);
  body.synergyMult = multiplier(raw.synergy ?? 127);
  body.chemistryMult = multiplier(raw.chemistry ?? 127);
  syncEffectiveStats(body);
}
function spawn(team, slot) {
  return { x: team ? (slot === 0 ? 820 : 690) : (slot === 0 ? 180 : 310), y: slot === 0 ? 300 : slot === 1 ? 180 : 420 };
}
function makeUbu(team, slot) {
  const { x, y } = spawn(team, slot);
  return {
    x, y, vx: 0, vy: 0, omega: 0, rotation: 0,
    team, slot,
    sizeMult: 1,
    radius: 25, mass: 3, friction: 150, reach: 25, strength: 1, stability: 1, bounciness: 1,
    baseRadius: 25, baseMass: 3, baseFriction: 150, baseReach: 25, baseStrength: 1, baseStability: 1, baseBounciness: 1,
    grip: .3, maxSpin: BASE_MAX_SPIN, impulse: IMPULSE, curveMult: 1, curveFactor: SKATER_CURVE, power: 1,
    synergyMult: 1, chemistryMult: 1,
    meter: 0, daze: 0, spinStrike: 0, launchSpin: 0,
    superTicks: 0, superHoldTicks: 0, superBonusTicks: 0, superBonusRefund: 0, ironCooldownTicks: 0,
    guarding: false, ironGuard: false,
    usedSuperThisTurn: false, superHit: false, superRefunded: false, shockwaveFired: false,
    carded: false, stunned: false, stunnedNext: false, holding: false,
    superActive: null, equippedSuper: null
  };
}
function makeBall() {
  return {
    x: 500, y: 300, vx: 0, vy: 0, omega: 0, rotation: 0,
    team: -1,
    radius: 18, mass: 1, friction: 85, grip: .3, maxSpin: 8, curveMult: 1,
    fireTicks: 0, onFire: false, pace: 0,
    strikerPower: 1, strikerSynergy: 1, strikerTeam: -1, strikerSlot: -1,
    openingShot: false, stuckTicks: 0, stickOffset: null
  };
}
function setStriker(ball, player) {
  ball.strikerPower = player.power || 1;
  ball.strikerSynergy = player.synergyMult ?? 1;
  ball.strikerTeam = player.team;
  ball.strikerSlot = player.slot ?? -1;
  ball.curveMult = player.curveMult ?? 1;
}
function clearStriker(ball) {
  ball.strikerPower = 1;
  ball.strikerSynergy = 1;
  ball.strikerTeam = -1;
  ball.strikerSlot = -1;
  ball.curveMult = 1;
}
function clearHeat(ball) {
  ball.fireTicks = 0;
  ball.onFire = false;
  ball.pace = 0;
}
const contactEvent = {
  a: null, b: null, speed: 0, impulse: 0, plow: false, iron: false,
  checker: null, snapped: false, spinStruck: false, tangentImpulse: 0, passerSlot: -1, struck: false,
  graze: 0, tangentSign: 1
};
function emitCollide(onCollide, a, b, speed, impulse = 0, plow = false, iron = false, checker = null, snapped = false, spinStruck = false, tangentImpulse = 0, passerSlot = -1, struck = false, graze = 0, tangentSign = 1) {
  if (typeof onCollide !== 'function') return;
  contactEvent.a = a;
  contactEvent.b = b;
  contactEvent.speed = speed;
  contactEvent.impulse = impulse;
  contactEvent.plow = plow;
  contactEvent.iron = iron;
  contactEvent.checker = checker;
  contactEvent.snapped = snapped;
  contactEvent.spinStruck = spinStruck;
  contactEvent.tangentImpulse = tangentImpulse;
  contactEvent.passerSlot = passerSlot;
  contactEvent.struck = struck;
  contactEvent.graze = graze;
  contactEvent.tangentSign = tangentSign;
  onCollide(contactEvent);
}
function kickoff() {
  const bodies = [];
  for (let team = 0; team < 2; team++) for (let i = 0; i < 3; i++) bodies.push(makeUbu(team, i));
  bodies.push(makeBall());
  return bodies;
}

let resolvedCount = 0;
function bumpResolved() { resolvedCount++; }
function getResolved() { return resolvedCount; }

function holder(bodies) {
  const limit = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
  for (let i = 0; i < limit; i++) if (bodies[i].holding) return bodies[i];
  return null;
}

module.exports = {
  VERSION, rink, DT, SUBSTEPS, BASE_LAUNCH_SPEED, IRON_COOLDOWN_TICKS, IMPULSE, SKATER_CURVE, BALL_CURVE, BURNING_BALL_CURVE, AIR_DRAG, BASE_MAX_SPIN, SPIN_DECAY, SETTLED_SPIN_DECAY, STRIKE_GAIN, CLOSE_SPIN_GAIN, STRIKE_POWER, SPIN_STRIKE_MIN_OMEGA, GUARD_BRAKE, SURFACES, SIZE, ICE_BITE, CARVE_DRIVE, TRUE_GLIDE, TEMPERED_SHOT, SWEET_SPOT, BOARD_SPRING, TAPE_TO_TAPE, PACK_DRAFT, HEAT, FIRE_TICKS, IRON_KEEP, HOT_DRIVE, SNAP, STRIKE_MIN_SPEED, RIM, TAILGATE, HIP_CLIP, TAILGATE_MIN_LEAD2, TAILGATE_MIN_FOLLOW2, TAILGATE_SPAN, PACK_MAX_FACTOR, bodyKE, scratchV2, scratchSpeed, skaterDraftAt, tailgateFactor, ballOnFire, ballCurveFactor, countSlowing, DAZE, daze, dazeSlow, SUPER, ballHitRadius, SUPERS, superMastery, MULT_TABLE, multiplier, carveDriveBoost, launchSpeed, colossusProgress, syncEffectiveStats, applyStats, spawn, makeUbu, makeBall, setStriker, clearStriker, clearHeat, contactEvent, emitCollide, kickoff, bumpResolved, getResolved, holder
};
