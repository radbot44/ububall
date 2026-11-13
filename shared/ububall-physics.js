'use strict';
(function (root) {
  // Bump VERSION with any change to how a turn plays out (startTurn, step and their tuning): saved
  // replays re-simulate their turns and refuse a different version (docs/ububall-file.md).
  const VERSION = 28;
  const rink = Object.freeze({ left: 60, right: 940, top: 60, bottom: 540, corner: 100, goalTop: 230, goalBottom: 370, goalDepth: 38 });
  const DT = 1 / 240, BASE_LAUNCH_SPEED = 720;
  const IRON_COOLDOWN_TICKS = 48; // ~200 ms at 240 Hz DT: cooldown after an Iron Save
  const IMPULSE = 3 * BASE_LAUNCH_SPEED;
  const SKATER_CURVE = .06, BALL_CURVE = .06, BURNING_BALL_CURVE = .08;
  const AIR_DRAG = .00015; // Quadratic drag on the ball, strongest on fast shots; ubus have none.
  const SPIN_DECAY = 5, SETTLED_SPIN_DECAY = 30; // Rad/s of spin every body loses each second (faster once linear motion settles).
  const STRIKE_GAIN = 1, CLOSE_SPIN_GAIN = 2; // Spin strike multiplier from range and at point blank.
  const STRIKE_POWER = .5; // Point-blank strike's extra ball speed at full spin, as a share of the ubu's speed.
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
  const HOT_DRIVE = 100;
  const SNAP = Object.freeze({ minPassSpeed: 180, minDrive: 140, redirect: .35, heatTicks: 30 });
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
    const spinMult = (body.maxSpin ?? 15) / 15;
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
    body.maxSpin = 15 * multiplier(raw.spin ?? 127);
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
      grip: .3, maxSpin: 15, impulse: IMPULSE, curveMult: 1, curveFactor: SKATER_CURVE, power: 1,
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
    checker: null, snapped: false, spinStruck: false, tangentImpulse: 0, passerSlot: -1
  };
  function emitCollide(onCollide, a, b, speed, impulse = 0, plow = false, iron = false, checker = null, snapped = false, spinStruck = false, tangentImpulse = 0, passerSlot = -1) {
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
    onCollide(contactEvent);
  }
  function kickoff() {
    const bodies = [];
    for (let team = 0; team < 2; team++) for (let i = 0; i < 3; i++) bodies.push(makeUbu(team, i));
    bodies.push(makeBall());
    return bodies;
  }
  let resolved = 0;
  function reflect(b, nx, ny, penetration, wallType = 'wall', onWall = null, isCorner = false, hostCarrier = null) {
    resolved++;
    b.x -= nx * penetration; b.y -= ny * penetration;
    const velocity = b.vx * nx + b.vy * ny;
    if (velocity > 0) {
      const surface = SURFACES[wallType];
      const carrier = b.team === -1 ? hostCarrier : null;
      const isMeteor = b.team === -1 && !carrier && ballOnFire(b) && surface.meteorBank;
      const preSpeed = isMeteor ? Math.hypot(b.vx, b.vy) : 0;
      const tx = -ny, ty = nx;
      const vt = b.vx * tx + b.vy * ty;
      const cornerSkater = isCorner && b.team >= 0;
      const rimmed = cornerSkater && velocity <= RIM.maxNormal && Math.abs(vt) >= RIM.minTangent && b.omega * vt < 0;
      const counterRim = cornerSkater && b.omega * vt > 0;
      if (!rimmed) {
        b.spinStrike = 0;
        if (b.team >= 0) b.launchSpin = 0;
      }
      const preRimKE = rimmed && !carrier ? bodyKE(b) : 0;
      const restitutionBody = carrier || b;
      const baseWallRest = wallType === 'wall' ? BOARD_SPRING.wallUbuRestitution : surface.restitution;
      let restitution = restitutionBody.team === -1 ? surface.restitution
        : (rimmed
          ? Math.min(surface.ubuRestitutionCap, baseWallRest * (restitutionBody.sizeMult ?? 1) ** SIZE.boards) * RIM.bounceScale
          : Math.min(surface.ubuRestitutionCap, baseWallRest * (restitutionBody.bounciness ?? 1) * (restitutionBody.sizeMult ?? 1) ** SIZE.boards));
      const effMass = carrier ? carrier.mass + b.mass : b.mass;
      const rebound = 1 + restitution;
      b.vx -= rebound * velocity * nx; b.vy -= rebound * velocity * ny;
      const slip = b.vx * tx + b.vy * ty + b.omega * b.radius;
      const gripScale = surface.gripScale * (counterRim ? RIM.checkGrip : 1);
      const limit = (b.grip * gripScale) * rebound * velocity * effMass;
      const impulse = Math.max(-limit, Math.min(limit, -slip * effMass / 3));
      b.vx += impulse * tx / effMass; b.vy += impulse * ty / effMass;
      b.omega += 2 * impulse / (effMass * b.radius);
      b.omega *= rimmed ? RIM.spinKeep : (surface.spinKeep ?? 0.5);
      if (rimmed && !carrier) {
        const postRimKE = bodyKE(b);
        const lostKE = preRimKE - postRimKE;
        if (lostKE > 0) {
          const redirectShare = Math.min(0.88, BOARD_SPRING.rimRedirect * (restitutionBody.bounciness ?? 1));
          const curVt = b.vx * tx + b.vy * ty;
          const curVn = b.vx * nx + b.vy * ny;
          const rotKE = .25 * b.mass * b.radius * b.radius * b.omega * b.omega;
          const targetKE = Math.min(preRimKE * (1 - 1e-12), postRimKE + redirectShare * lostKE);
          const availVt2 = Math.max(curVt * curVt, (2 * Math.max(0, targetKE - rotKE)) / b.mass - curVn * curVn);
          const tSign = (curVt || vt) >= 0 ? 1 : -1;
          const newVt = tSign * Math.sqrt(availVt2);
          b.vx = curVn * nx + newVt * tx;
          b.vy = curVn * ny + newVt * ty;
        }
      }
      if (isMeteor && preSpeed > 0) {
        const postSpeed = Math.hypot(b.vx, b.vy);
        if (postSpeed > 0) {
          const scale = preSpeed / postSpeed;
          b.vx *= scale; b.vy *= scale;
        }
      }
      if (typeof onWall === 'function') onWall(b, velocity, wallType, nx, ny, rimmed);
    }
  }
  function walls(b, onWall = null, carrier = null) {
    const r = b.radius;
    if (rink.left === 60 && b.x >= 150 && b.x <= 850 && b.y >= 60 + r && b.y <= 540 - r) return;
    const k = rink;
    if (b.x >= k.left + r && b.x <= k.right - r && b.y >= k.top + r && b.y <= k.bottom - r &&
        ((b.x >= k.left + k.corner && b.x <= k.right - k.corner) || (b.y >= k.top + k.corner && b.y <= k.bottom - k.corner))) return;
    const inGoalY = b.y > k.goalTop && b.y < k.goalBottom, before = b.team === -1 ? Math.hypot(b.vx, b.vy) : 0;
    const inLeftPocket = inGoalY || (b.x < k.left && b.y > k.goalTop - r && b.y < k.goalBottom + r);
    const inRightPocket = inGoalY || (b.x > k.right && b.y > k.goalTop - r && b.y < k.goalBottom + r);

    if (inLeftPocket) {
      const backX = k.left - k.goalDepth + r;
      if (b.x < backX) {
        reflect(b, -1, 0, backX - b.x, 'net', onWall, false, carrier);
        if (b.team === -1) { b.vx *= 0.1; b.vy *= 0.1; }
      }
      if (b.x < k.left) {
        if (b.y < k.goalTop + r) reflect(b, 0, -1, k.goalTop + r - b.y, 'net', onWall, false, carrier);
        if (b.y > k.goalBottom - r) reflect(b, 0, 1, b.y - (k.goalBottom - r), 'net', onWall, false, carrier);
      } else if (b.x < k.left + r) {
        for (let pi = 0; pi < 2; pi++) {
          const y = pi === 0 ? k.goalTop : k.goalBottom;
          const dx = k.left - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, r - d, 'post', onWall, false, carrier); }
        }
      }
    } else {
      if (b.x < k.left + r) reflect(b, -1, 0, k.left + r - b.x, 'wall', onWall, false, carrier);
    }

    if (inRightPocket) {
      const backX = k.right + k.goalDepth - r;
      if (b.x > backX) {
        reflect(b, 1, 0, b.x - backX, 'net', onWall, false, carrier);
        if (b.team === -1) { b.vx *= 0.1; b.vy *= 0.1; }
      }
      if (b.x > k.right) {
        if (b.y < k.goalTop + r) reflect(b, 0, -1, k.goalTop + r - b.y, 'net', onWall, false, carrier);
        if (b.y > k.goalBottom - r) reflect(b, 0, 1, b.y - (k.goalBottom - r), 'net', onWall, false, carrier);
      } else if (b.x > k.right - r) {
        for (let pi = 0; pi < 2; pi++) {
          const y = pi === 0 ? k.goalTop : k.goalBottom;
          const dx = k.right - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, r - d, 'post', onWall, false, carrier); }
        }
      }
    } else {
      if (b.x > k.right - r) reflect(b, 1, 0, b.x - k.right + r, 'wall', onWall, false, carrier);
    }

    const insidePocket = (b.x < k.left && inLeftPocket) || (b.x > k.right && inRightPocket);
    if (!insidePocket) {
      if (b.y < k.top + r) reflect(b, 0, -1, k.top + r - b.y, 'wall', onWall, false, carrier);
      if (b.y > k.bottom - r) reflect(b, 0, 1, b.y - k.bottom + r, 'wall', onWall, false, carrier);
      const cx = b.x < k.left + k.corner ? k.left + k.corner : (b.x > k.right - k.corner ? k.right - k.corner : -1);
      const cy = b.y < k.top + k.corner ? k.top + k.corner : (b.y > k.bottom - k.corner ? k.bottom - k.corner : -1);
      if (cx >= 0 && cy >= 0) {
        const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy, limit = k.corner - r;
        if (limit < 0 || d2 > limit * limit) {
          const d = Math.sqrt(d2);
          const nx = d > 0 ? dx / d : (cx < 500 ? -Math.SQRT1_2 : Math.SQRT1_2);
          const ny = d > 0 ? dy / d : (cy < 300 ? -Math.SQRT1_2 : Math.SQRT1_2);
          reflect(b, nx, ny, d - limit, 'wall', onWall, true, carrier);
        }
      }
    }
    if (before) countSlowing(b, before);
  }
  function triggerShockwave(source, bodies, onShockwave, inRange = null) {
    const radius = SUPER.shockRadius;
    if (inRange) {
      for (let i = 0; i < inRange.length; i++) {
        const { opp, d, dx, dy } = inRange[i];
        const force = (1 - d / radius) * SUPER.shockForce;
        const m = opp.mass || 1;
        opp.vx += (dx / d) * force / m;
        opp.vy += (dy / d) * force / m;
      }
    } else {
      const sourceTeam = source.team;
      const limit = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
      for (let i = 0; i < limit; i++) {
        const b = bodies[i];
        const isTeammate = sourceTeam !== undefined && b.team !== undefined && b.team === sourceTeam;
        if (b === source || b.team === -1 || isTeammate || b.superActive === 'stalwart' || b.carded) continue;
        const dx = b.x - source.x, dy = b.y - source.y, d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < radius * radius) {
          const d = Math.sqrt(d2);
          const force = (1 - d / radius) * SUPER.shockForce;
          const m = b.mass || 1;
          b.vx += (dx / d) * force / m;
          b.vy += (dy / d) * force / m;
        }
      }
    }
    if (typeof onShockwave === 'function') onShockwave(source, radius);
  }
  function triggerIronShockwave(source, bodies, onShockwave) {
    const radius = SUPER.shockRadius * 0.5;
    const force = 400;
    const limit = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
    for (let i = 0; i < limit; i++) {
      const b = bodies[i];
      if (b === source || b.team === -1 || b.superActive === 'stalwart' || b.carded) continue;
      const dx = b.x - source.x, dy = b.y - source.y, d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < radius * radius) {
        const d = Math.sqrt(d2);
        const impulse = (1 - d / radius) * force * (b.team === source.team ? SUPER.shockTeammate : 1);
        const m = b.mass || 1;
        b.vx += (dx / d) * impulse / m;
        b.vy += (dy / d) * impulse / m;
      }
    }
    if (typeof onShockwave === 'function') onShockwave(source, radius, 'iron');
  }
  function applyDoubledGuard(b) {
    if (!b.guarding) return;
    b.ironGuard = true;
    syncEffectiveStats(b);
  }
  function endSuper(b, bodies) {
    if (b.holding) {
      b.holding = false;
      const ball = bodies ? (bodies.length === 7 && bodies[6].team === -1 ? bodies[6] : bodies.find(o => o.team === -1)) : null;
      if (ball) ball.stickOffset = null;
    }
    if ((b.superActive || b.usedSuperThisTurn) && !b.superRefunded) {
      b.superRefunded = true;
      const bonusRefund = b.equippedSuper?.bonusRefund ?? b.superBonusRefund ?? 0;
      const whiff = !b.superHit ? SUPER.whiffRefund : 0;
      const refund = bonusRefund + whiff;
      if (refund > 0) b.meter = Math.min(100, (b.meter || 0) + refund);
    }
    b.superActive = null; b.superTicks = 0; b.superHoldTicks = 0; b.shockwaveFired = false; b.superHit = false;
    syncEffectiveStats(b);
  }
  function collide(a, b, onCollide = null, allBodies = null, onShockwave = null, onSuper = null, deferIronBlast = false) {
    const isBall = a.team === -1 || b.team === -1;
    if (!isBall && (a.carded || b.carded)) return;
    if (isBall && ((a.team !== -1 && a.carded) || (b.team !== -1 && b.carded))) return;
    if (!isBall && a.team !== b.team && (a.superActive === 'ghost' || b.superActive === 'ghost')) return;

    const ball = isBall ? (a.team === -1 ? a : b) : null;
    const player = isBall ? (ball === a ? b : a) : null;
    if (player && player.holding) return;

    const ra = (isBall && a.team !== -1) ? ballHitRadius(a) : a.radius;
    const rb = (isBall && b.team !== -1) ? ballHitRadius(b) : b.radius;
    const dx = b.x - a.x, dy = b.y - a.y, radius = ra + rb;
    const d2 = dx * dx + dy * dy;
    if (d2 > radius * radius) return;
    resolved++;
    const d = Math.sqrt(d2);
    const preNx = d ? dx / d : 1, preNy = d ? dy / d : 0;
    const preClosing = (b.vx - a.vx) * preNx + (b.vy - a.vy) * preNy;
    const carrier = isBall && allBodies ? holder(allBodies) : null;
    if (carrier && carrier !== player) {
      if (player.superActive === 'sticky' || (player.team !== carrier.team && preClosing < 0 && (ball.stuckTicks || 0) > 0)) {
        endSuper(carrier, allBodies);
      } else {
        const overlap = radius - d;
        const pIsA = player === a, sign = pIsA ? 1 : -1;
        const cMass = carrier.mass + ball.mass;
        const invP = player.superActive === 'stalwart' ? 0 : 1 / player.mass;
        const invC = carrier.superActive === 'stalwart' ? 0 : 1 / cMass;
        const invSum = invP + invC;
        if (invSum > 0) {
          const corr = overlap / invSum;
          if (invP > 0) { player.x -= sign * preNx * corr * invP; player.y -= sign * preNy * corr * invP; }
          if (invC > 0) { carrier.x += sign * preNx * corr * invC; carrier.y += sign * preNy * corr * invC; }
          if (preClosing < 0) {
            const j = -(1 + .88) * preClosing / invSum;
            if (invP > 0) { player.vx -= sign * j * preNx * invP; player.vy -= sign * j * preNy * invP; }
            if (invC > 0) { carrier.vx += sign * j * preNx * invC; carrier.vy += sign * j * preNy * invC; }
            emitCollide(onCollide, pIsA ? player : carrier, pIsA ? carrier : player, -preClosing, j);
          }
        }
        const off = ball.stickOffset || { x: carrier.radius + ball.radius, y: 0 };
        ball.x = carrier.x + off.x; ball.y = carrier.y + off.y;
        ball.vx = carrier.vx; ball.vy = carrier.vy; ball.omega = carrier.omega;
        return;
      }
    }
    const own = Boolean(player) && player.team === ball.strikerTeam, hot = isBall ? ballOnFire(ball) : false;
    const drive = player ? (player.vx * (ball.x - player.x) + player.vy * (ball.y - player.y)) / (d || 1) : 0;
    let closeSpin = 0, strikeBoost = 0;
    let crowdedBall = false;
    if (isBall) {
      const psa = player.superActive;
      if (psa && (psa === 'cannonball' || psa === 'sticky' || psa === 'magnet' || psa === 'ghost' || psa === 'stalwart' || psa === 'colossus')) {
        player.superHit = true;
      }
      if (ball.openingShot && player.spinStrike) {
        const small = (player.sizeMult || 1) ** SIZE.strike;
        closeSpin = -player.spinStrike * player.omega * small * (player.curveMult || 1);
        strikeBoost = small * STRIKE_POWER * (player.spinStrike - STRIKE_GAIN) * Math.min(1, Math.abs(player.omega) / player.maxSpin) * Math.hypot(player.vx, player.vy);
      }
      if (allBodies) {
        const lim = allBodies.length === 7 && allBodies[6].team === -1 ? 6 : allBodies.length;
        for (let k = 0; k < lim; k++) {
          const other = allBodies[k];
          if (other !== player && other.team >= 0 && !other.carded) {
            const cdx = other.x - ball.x, cdy = other.y - ball.y, cr = ballHitRadius(other) + ball.radius;
            if (cdx * cdx + cdy * cdy <= cr * cr) { crowdedBall = true; break; }
          }
        }
      }
      if (closeSpin && crowdedBall) closeSpin = strikeBoost = 0;
      ball.openingShot = false;
    } else {
      a.spinStrike = b.spinStrike = 0;
      a.launchSpin = b.launchSpin = 0;
    }

    const nx = preNx, ny = preNy;
    const closing = preClosing;

    let knockoutChecker = null;
    if (!isBall && a.team !== b.team && closing < 0) {
      if (a.superActive === 'knockout' || a.superActive === 'stalwart' || a.superActive === 'colossus') a.superHit = true;
      if (b.superActive === 'knockout' || b.superActive === 'stalwart' || b.superActive === 'colossus') b.superHit = true;
      if (a.superActive === 'knockout') { b.stunnedNext = true; a.superActive = null; onSuper?.('knockout', 'impact', a, b); knockoutChecker = a; }
      if (b.superActive === 'knockout') { a.stunnedNext = true; b.superActive = null; onSuper?.('knockout', 'impact', b, a); knockoutChecker = knockoutChecker || b; }
      if (a.superActive === 'sticky' && a.holding) endSuper(a, allBodies);
      if (b.superActive === 'sticky' && b.holding) endSuper(b, allBodies);
    }
    const restitution = .88;
    let fireWin = -1, ironSave = false;

    if (isBall && player.superActive === 'sticky') {
      if (allBodies) {
        const lim = allBodies.length === 7 && allBodies[6].team === -1 ? 6 : allBodies.length;
        for (let k = 0; k < lim; k++) {
          const o = allBodies[k];
          if (o.team >= 0 && o.holding && o !== player) endSuper(o, allBodies);
        }
      }
      player.holding = true; ball.stuckTicks = 0;
      onSuper?.('sticky', 'impact', player, ball);
      if (!own) clearHeat(ball);
      setStriker(ball, player);
      const ox = ball === b ? dx : -dx, oy = ball === b ? dy : -dy, od = d || 1;
      const targetDist = player.radius + ball.radius;
      ball.stickOffset = { x: (ox / od) * targetDist, y: (oy / od) * targetDist };
      ball.x = player.x + ball.stickOffset.x;
      ball.y = player.y + ball.stickOffset.y;
      if (player.superActive !== 'stalwart') {
        const totalMass = player.mass + ball.mass;
        player.vx = (player.vx * player.mass + ball.vx * ball.mass) / totalMass;
        player.vy = (player.vy * player.mass + ball.vy * ball.mass) / totalMass;
      }
      ball.vx = player.vx;
      ball.vy = player.vy;
      ball.omega = player.omega;
      emitCollide(onCollide, a, b, Math.max(0, -closing), 0);
      return;
    }

    if (isBall) {
      const isFire = hot;
      const ballSpeed = Math.hypot(ball.vx, ball.vy);
      const isTeammate = ball.strikerTeam !== undefined && ball.strikerTeam >= 0 && ball.strikerTeam === player.team;
      const isFriendlyPass = isTeammate && !isFire && (ballSpeed >= 175 || (ball.pace || 0) >= 175);
      if ((isFire || isFriendlyPass) && player.superActive !== 'cannonball' && closing < 0) {
        const pbx = ball.x - player.x, pby = ball.y - player.y;
        const pbDist = Math.hypot(pbx, pby) || 1;
        const pnx = pbx / pbDist, pny = pby / pbDist;
        if (ballSpeed > 50) {
          const bux = ball.vx / ballSpeed, buy = ball.vy / ballSpeed;
          const delta = Math.max(0, -(bux * pnx + buy * pny));

          let R = 0;
          if (player.superActive === 'stalwart') {
            R = Infinity;
          } else {
            const normMass = (player.baseMass || player.mass) / 3;
            const baseStab = player.baseStability ?? player.stability ?? 1;
            const guardMult = player.guarding ? (player.ironGuard ? 4.0 : 2.0) : 1.0;
            const colossusMult = player.superActive === 'colossus' ? Math.max(1, player.mass / (player.baseMass || player.mass)) : 1.0;
            R = normMass * baseStab * (1 + delta * delta) * guardMult * colossusMult;
          }

          const strikerPow = (ball.strikerPower || 1) ** TEMPERED_SHOT.firePowerExp;
          const E = (ballSpeed / BASE_LAUNCH_SPEED) * strikerPow * 2.8;

          if (isFire && E > R) {
            fireWin = R / E;
          } else if (player.guarding && (!player.ironCooldownTicks || player.ironCooldownTicks <= 0) && (isFriendlyPass || E <= R)) {
            const opposing = ball.strikerTeam !== undefined && ball.strikerTeam >= 0 && ball.strikerTeam !== player.team;
            if (opposing) {
              ball.onFire = false;
              ball.fireTicks = 0;
            }
            ironSave = true;
            player.ironGuard = true;
            player.ironCooldownTicks = IRON_COOLDOWN_TICKS;
            applyDoubledGuard(player);
            if (allBodies && !deferIronBlast) triggerIronShockwave(player, allBodies, onShockwave);
          }
        }
      }
    }

    const stalwartA = a.team >= 0 && a.superActive === 'stalwart';
    const stalwartB = b.team >= 0 && b.superActive === 'stalwart';
    const anchorA = stalwartA && a.vx === 0 && a.vy === 0;
    const anchorB = stalwartB && b.vx === 0 && b.vy === 0;
    const rawInvA = fireWin >= 0 && a.team === -1 ? fireWin / b.mass : 1 / a.mass;
    const rawInvB = fireWin >= 0 && b.team === -1 ? fireWin / a.mass : 1 / b.mass;
    const invA = anchorA ? 0 : rawInvA;
    const invB = anchorB ? 0 : rawInvB;
    const inverse = invA + invB;

    const overlap = radius - d;
    if (stalwartA && !stalwartB) {
      b.x += nx * overlap; b.y += ny * overlap;
    } else if (stalwartB && !stalwartA) {
      a.x -= nx * overlap; a.y -= ny * overlap;
    } else if (rawInvA + rawInvB > 0) {
      const correction = overlap / (rawInvA + rawInvB);
      a.x -= nx * correction * rawInvA; a.y -= ny * correction * rawInvA;
      b.x += nx * correction * rawInvB; b.y += ny * correction * rawInvB;
    }

    if (closing >= 0) return;
    if (inverse === 0) {
      if (!isBall) {
        if (stalwartA) onSuper?.('stalwart', 'impact', a, b);
        if (stalwartB) onSuper?.('stalwart', 'impact', b, a);
      }
      emitCollide(onCollide, a, b, -closing, 0, false, false, knockoutChecker);
      return;
    }
    const preRvx = b.vx - a.vx, preRvy = b.vy - a.vy;
    const preBallSpeed = isBall ? Math.hypot(ball.vx, ball.vy) : 0;
    const pairKEBefore = isBall ? bodyKE(player) + bodyKE(ball) : 0;
    if (!isBall) {
      if (stalwartA) onSuper?.('stalwart', 'impact', a, b);
      if (stalwartB) onSuper?.('stalwart', 'impact', b, a);
    }

    const baseImpulse = -(1 + restitution) * closing / inverse;

    let impulseA = baseImpulse, impulseB = baseImpulse, sweetMult = 1;
    if (isBall) {
      const bodyCoreDist = Math.max(player.radius, 25) + ball.radius;
      const maxReachDist = ballHitRadius(player) + ball.radius;
      const pokeFrac = d > bodyCoreDist ? Math.min(1, (d - bodyCoreDist) / Math.max(1, maxReachDist - bodyCoreDist)) : 0;
      sweetMult = 1 - (1 - SWEET_SPOT.pokeTipMin) * pokeFrac;
      if (a.team !== -1 && a.power) impulseB *= a.power;
      else if (b.team !== -1 && b.power) impulseA *= b.power;
    } else {
      const strA = a.strength || 1, stabA = a.stability || 1;
      const strB = b.strength || 1, stabB = b.stability || 1;
      impulseB *= (strA / stabB);
      impulseA *= (strB / stabA);
    }

    const normalA = a.vx * nx + a.vy * ny, normalB = b.vx * nx + b.vy * ny;
    const energyBefore = (invA ? a.mass * normalA * normalA : 0)
      + (invB ? b.mass * normalB * normalB : 0);
    const nextA = invA ? normalA - impulseA * invA : 0;
    const nextB = invB ? normalB + impulseB * invB : 0;
    const energyAfter = (invA ? a.mass * nextA * nextA : 0)
      + (invB ? b.mass * nextB * nextB : 0);
    const scale = energyAfter > energyBefore ? Math.sqrt(energyBefore / energyAfter) : 1;
    if (invA) impulseA = (normalA - nextA * scale) / invA;
    if (invB) impulseB = (nextB * scale - normalB) / invB;
    if (isBall && sweetMult < 1) {
      if (a.team === -1) impulseA *= sweetMult;
      else impulseB *= sweetMult;
    }

    let cannon = null, cannonImpulse = 0;
    if (isBall) {
      if (a.team !== -1 && a.superActive === 'cannonball') { cannon = a; cannonImpulse = SUPER.cannonball * impulseB; }
      else if (b.team !== -1 && b.superActive === 'cannonball') { cannon = b; cannonImpulse = -SUPER.cannonball * impulseA; }
    }

    if (invA > 0) {
      a.vx -= impulseA * nx * invA; a.vy -= impulseA * ny * invA;
    }
    if (invB > 0) {
      b.vx += impulseB * nx * invB; b.vy += impulseB * ny * invB;
    }

    let checker = knockoutChecker;
    if (!isBall && a.team !== b.team) {
      const driveA = normalA, driveB = -normalB;
      const knockA = Math.abs(impulseA * invA), knockB = Math.abs(impulseB * invB);
      if (!checker) {
        if (driveB > driveA && knockA > DAZE.speed && !stalwartA) checker = b;
        else if (driveA > driveB && knockB > DAZE.speed && !stalwartB) checker = a;
      }
      if (driveB >= driveA) daze(a, knockA);
      if (driveA >= driveB) daze(b, knockB);
    }
    if (fireWin >= 0) {
      if (a.team === -1) daze(b, Math.abs(impulseB * invB)); else daze(a, Math.abs(impulseA * invA));
    }

    const tx = -ny, ty = nx;
    const frictionA = anchorA ? 0 : 1 / a.mass, frictionB = anchorB ? 0 : 1 / b.mass;
    const spinA = !stalwartA, spinB = !stalwartB;
    const rvt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
    const relSpeed = Math.hypot(preRvx, preRvy);
    const hipClip = !isBall && a.team !== b.team && closing < 0 &&
      relSpeed >= HIP_CLIP.minRelSpeed && Math.abs(rvt) >= Math.abs(closing) * HIP_CLIP.glanceRatio;
    const slip = rvt - a.omega * a.radius - b.omega * b.radius;
    const gripPair = Math.sqrt(a.grip * b.grip);
    const limit = gripPair * baseImpulse;
    const massDenom = frictionA + frictionB;
    const slipDenom = massDenom + (spinA ? 2 * frictionA : 0) + (spinB ? 2 * frictionB : 0);
    const effectiveLimit = hipClip && massDenom > 0
      ? limit + gripPair * HIP_CLIP.gripBoost * Math.abs(rvt) / massDenom
      : limit;
    const tangent = slipDenom > 0 ? Math.max(-effectiveLimit, Math.min(effectiveLimit, -slip / slipDenom)) : 0;

    if (frictionA > 0) {
      a.vx -= tangent * tx * frictionA; a.vy -= tangent * ty * frictionA;
      if (spinA) {
        let dOmegaA = -2 * tangent * frictionA / a.radius;
        if (hipClip && Math.abs(a.omega + dOmegaA) > Math.abs(a.omega)) dOmegaA /= Math.max(1, a.stability || 1);
        a.omega += dOmegaA;
      }
    }
    if (frictionB > 0) {
      b.vx += tangent * tx * frictionB; b.vy += tangent * ty * frictionB;
      if (spinB) {
        let dOmegaB = -2 * tangent * frictionB / b.radius;
        if (hipClip && Math.abs(b.omega + dOmegaB) > Math.abs(b.omega)) dOmegaB /= Math.max(1, b.stability || 1);
        b.omega += dOmegaB;
      }
    }

    let snapped = false;
    const pSlot = player ? (player.slot ?? -1) : -1;
    const prevStrikerTeam = isBall ? ball.strikerTeam : -1;
    const prevStrikerSlot = isBall ? (ball.strikerSlot ?? -1) : -1;
    if (isBall && closing < 0 && fireWin < 0 && !ironSave && !hot &&
        player.superActive !== 'sticky' && !player.guarding && !crowdedBall &&
        ball.strikerTeam === player.team && ball.strikerSlot !== undefined &&
        ball.strikerSlot >= 0 && pSlot >= 0 && ball.strikerSlot !== pSlot &&
        preBallSpeed >= SNAP.minPassSpeed && drive >= SNAP.minDrive) {
      const curBallSpeed = Math.hypot(ball.vx, ball.vy);
      const away = ball === b ? 1 : -1;
      const ux = curBallSpeed ? ball.vx / curBallSpeed : nx * away;
      const uy = curBallSpeed ? ball.vy / curBallSpeed : ny * away;
      const tapeMult = ((ball.strikerSynergy || 1) * (player.chemistryMult || 1)) ** TAPE_TO_TAPE.snapExp;
      const targetBallSpeed = curBallSpeed + SNAP.redirect * preBallSpeed * (player.power || 1) * tapeMult;
      let playerTransKE = .5 * player.mass * (player.vx * player.vx + player.vy * player.vy);
      const playerRotKE = .25 * player.mass * player.radius * player.radius * player.omega * player.omega;
      const ballRotKEAfter = .25 * ball.mass * ball.radius * ball.radius * ball.omega * ball.omega;
      let availTransKE = Math.max(0, pairKEBefore - (playerTransKE + playerRotKE) - ballRotKEAfter);
      const desiredTransKE = .5 * ball.mass * targetBallSpeed * targetBallSpeed;
      if (desiredTransKE > availTransKE && playerTransKE > 0 && player.superActive !== 'stalwart') {
        const transferKE = Math.min(desiredTransKE - availTransKE, playerTransKE * .45);
        const pScale = Math.sqrt(Math.max(0, playerTransKE - transferKE) / playerTransKE);
        player.vx *= pScale;
        player.vy *= pScale;
        playerTransKE = .5 * player.mass * (player.vx * player.vx + player.vy * player.vy);
        availTransKE = Math.max(0, pairKEBefore - (playerTransKE + playerRotKE) - ballRotKEAfter);
      }
      let postBallSpeed = Math.max(curBallSpeed, Math.min(targetBallSpeed, Math.sqrt(2 * availTransKE / ball.mass)));
      if (playerTransKE + playerRotKE + ballRotKEAfter + .5 * ball.mass * postBallSpeed * postBallSpeed > pairKEBefore) {
        postBallSpeed *= 1 - 1e-15;
      }
      ball.vx = ux * postBallSpeed;
      ball.vy = uy * postBallSpeed;
      ball.fireTicks = Math.min(FIRE_TICKS, (ball.fireTicks || 0) + SNAP.heatTicks);
      ball.pace = Math.max(ball.pace || 0, postBallSpeed);
      snapped = true;
    }

    if (cannon) {
      ball.vx += cannonImpulse * nx / ball.mass;
      ball.vy += cannonImpulse * ny / ball.mass;
      cannon.superActive = null;
      ball.fireTicks = FIRE_TICKS;
      ball.onFire = true;
      setStriker(ball, cannon);
      onSuper?.('cannonball', 'impact', cannon, ball);
    } else if (isBall && closing < 0 && fireWin < 0) {
      setStriker(ball, player);
      ball.strikerSlot = pSlot;
    } else if (isBall && fireWin < 0) {
      ball.curveMult = player.curveMult ?? 1;
    }

    let spinStruck = false;
    if (closeSpin) {
      const away = ball === b ? 1 : -1;
      ball.omega = Math.max(-24, Math.min(24, ball.omega + closeSpin));
      const speed = Math.hypot(ball.vx, ball.vy);
      ball.vx += (speed ? ball.vx / speed : nx * away) * strikeBoost;
      ball.vy += (speed ? ball.vy / speed : ny * away) * strikeBoost;
      if (strikeBoost) spinStruck = true;
    }
    if (ironSave) {
      if (!anchorA) { a.vx *= IRON_KEEP; a.vy *= IRON_KEEP; a.omega *= IRON_KEEP; }
      if (!anchorB) { b.vx *= IRON_KEEP; b.vy *= IRON_KEEP; b.omega *= IRON_KEEP; }
    }
    if (ball) {
      const speed = Math.hypot(ball.vx, ball.vy), pace = ball.pace || 0;
      if (!own) ball.pace = speed;
      else if (snapped && speed > pace) ball.pace = speed;
      else if (!ironSave && hot && drive >= HOT_DRIVE && pace > speed) {
        const ux = speed ? ball.vx / speed : (ball.x - player.x) / (d || 1), uy = speed ? ball.vy / speed : (ball.y - player.y) / (d || 1);
        ball.vx = ux * pace; ball.vy = uy * pace;
      }
    }

    const passerSlot = (isBall && closing < 0 && fireWin < 0 && !ironSave && !player.guarding &&
      prevStrikerTeam === player.team && prevStrikerSlot >= 0 && pSlot >= 0 && prevStrikerSlot !== pSlot &&
      preBallSpeed >= TAPE_TO_TAPE.minPassSpeed) ? prevStrikerSlot : -1;
    emitCollide(onCollide, a, b, -closing, baseImpulse, fireWin >= 0, ironSave, checker, snapped, spinStruck, Math.abs(tangent), passerSlot);
  }

  let spareRadii = new Float64Array(7), spareDrafts = new Float64Array(7);
  const shockOpp = new Array(6), shockD = new Float64Array(6), shockDx = new Float64Array(6), shockDy = new Float64Array(6);

  function step(bodies, dt = DT, onCollide = null, onWall = null, onShockwave = null, onSuper = null) {
    let hasStalwart = false;
    if (onSuper) {
      for (let i = 0; i < bodies.length; i++) {
        if (bodies[i].team >= 0 && bodies[i].superActive === 'stalwart') { hasStalwart = true; break; }
      }
    }
    let stalwartHits = 0;
    const guardedOnSuper = !onSuper ? null : (!hasStalwart ? onSuper : (key, action, a, b) => {
      if (key === 'stalwart' && action === 'impact') {
        const bit = 1 << ((bodies.indexOf(a) * 6 + bodies.indexOf(b)) & 30);
        if (stalwartHits & bit) return;
        stalwartHits |= bit;
      }
      onSuper(key, action, a, b);
    });

    const count = bodies.length;
    const std7 = count === 7 && bodies[6].team === -1;
    const ball = std7 ? bodies[6] : bodies.find(b => b.team === -1);
    const skaterEnd = std7 ? 6 : count;

    if (ball && ball.openingShot) {
      let touching = 0, b = null;
      const br = ball.radius;
      for (let i = 0; i < skaterEnd; i++) {
        const other = bodies[i];
        if (!std7 && other.team < 0) continue;
        if (!other.carded) {
          const dx = other.x - ball.x, dy = other.y - ball.y, lim = ballHitRadius(other) + br;
          if (dx * dx + dy * dy <= lim * lim) { touching++; b = other; }
        }
      }
      if (touching > 1 || (touching === 1 && !b.spinStrike)) ball.openingShot = false;
      if (touching === 1) {
        if ((ball.vx - b.vx) * (ball.x - b.x) + (ball.vy - b.vy) * (ball.y - b.y) >= 0) ball.openingShot = false;
      }
    }

    let host = null, hasMagnet = false, hasShockwave = false, hasTimedSuper = false;
    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (!std7 && b.team < 0) continue;
      if (b.holding && !host) host = b;
      if (b.ironCooldownTicks > 0) b.ironCooldownTicks--;
      const sa = b.superActive;
      if (sa) {
        if (sa === 'magnet') hasMagnet = true;
        if (sa === 'shockwave') hasShockwave = true;
        if (b.superTicks > 0) hasTimedSuper = true;
      }
    }
    if (!ball) host = null;

    if (ball && !host && hasMagnet) {
      const magR2 = SUPER.magnetRadius * SUPER.magnetRadius;
      for (let i = 0; i < skaterEnd; i++) {
        const b = bodies[i];
        if (!std7 && b.team < 0) continue;
        if (!b.carded && b.superActive === 'magnet') {
          const dx = b.x - ball.x, dy = b.y - ball.y, d2 = dx * dx + dy * dy;
          const minDist = b.radius + ball.radius;
          if (d2 > minDist * minDist && d2 < magR2) {
            const d = Math.sqrt(d2);
            b.superHit = true;
            const pull = SUPER.magnetPull * (1 - d / SUPER.magnetRadius), before = Math.hypot(ball.vx, ball.vy);
            ball.vx += (dx / d) * pull * dt;
            ball.vy += (dy / d) * pull * dt;
            if (b.team !== ball.strikerTeam) countSlowing(ball, before);
            onSuper?.('magnet', 'pull', b);
          }
        }
      }
    }

    if (hasTimedSuper) {
      hasShockwave = false;
      for (let i = 0; i < skaterEnd; i++) {
        const b = bodies[i];
        if (!std7 && b.team < 0) continue;
        if (!b.superActive || !b.superTicks) continue;
        if (--b.superTicks > 0) {
          if (b.superActive === 'shockwave') hasShockwave = true;
          if (b.superActive === 'colossus' && b.radius < Math.max(b.baseRadius ?? b.radius, SUPER.colossusRadius)) syncEffectiveStats(b);
          continue;
        }
        endSuper(b, bodies);
        if (b === host) host = null;
      }
    }

    if (hasShockwave) {
      const shockR2 = SUPER.shockRadius * SUPER.shockRadius;
      for (let i = 0; i < skaterEnd; i++) {
        const b = bodies[i];
        if (!std7 && b.team < 0) continue;
        if (b.superActive === 'shockwave') {
          let nInRange = 0;
          for (let j = 0; j < skaterEnd; j++) {
            const opp = bodies[j];
            if (!std7 && opp.team < 0) continue;
            if (opp.team !== b.team && !opp.carded && opp.superActive !== 'stalwart') {
              const dx = opp.x - b.x, dy = opp.y - b.y, d2 = dx * dx + dy * dy;
              if (d2 > 0 && d2 < shockR2) {
                shockOpp[nInRange] = opp;
                shockD[nInRange] = Math.sqrt(d2);
                shockDx[nInRange] = dx;
                shockDy[nInRange] = dy;
                nInRange++;
              }
            }
          }
          if (!b.shockwaveFired) {
            if (nInRange > 0) {
              b.shockwaveFired = true;
              b.superHit = true;
              const radius = SUPER.shockRadius;
              for (let k = 0; k < nInRange; k++) {
                const opp = shockOpp[k], d = shockD[k];
                const force = (1 - d / radius) * SUPER.shockForce;
                const m = opp.mass || 1;
                opp.vx += (shockDx[k] / d) * force / m;
                opp.vy += (shockDy[k] / d) * force / m;
              }
              if (typeof onShockwave === 'function') onShockwave(b, radius);
            }
          } else {
            for (let k = 0; k < nInRange; k++) {
              const opp = shockOpp[k], d = shockD[k];
              const repel = SUPER.shockRepel * (1 - d / SUPER.shockRadius);
              opp.vx += (shockDx[k] / d) * repel * dt;
              opp.vy += (shockDy[k] / d) * repel * dt;
            }
          }
          for (let k = 0; k < nInRange; k++) shockOpp[k] = null;
        }
      }
    }

    if (host && ++ball.stuckTicks >= (host.superHoldTicks || SUPER.holdTicks)) { endSuper(host, bodies); host = null; }

    let settledSpin = -1; // -1 unknown, 0 false, 1 true
    const checkSettledSpin = () => {
      if (hasMagnet) return 0;
      for (let j = 0; j < skaterEnd; j++) {
        const o = bodies[j];
        if (!std7 && o.team < 0) continue;
        if (o.vx * o.vx + o.vy * o.vy >= 4) return 0;
      }
      if (ball && ball.vx * ball.vx + ball.vy * ball.vy >= 4) return 0;
      return 1;
    };

    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (!std7 && b === ball) {
        if (host) continue;
        if (b.vx === 0 && b.vy === 0 && b.omega === 0) continue;
        if (b.omega !== 0) {
          if (b.vx !== 0 || b.vy !== 0) {
            const angle = b.omega * ballCurveFactor(b) * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = b.vx;
            b.vx = vx * cos - b.vy * sin; b.vy = vx * sin + b.vy * cos;
          }
          if (settledSpin < 0) settledSpin = checkSettledSpin();
          const spinDecay = settledSpin ? SETTLED_SPIN_DECAY : SPIN_DECAY;
          b.rotation += b.omega * dt;
          b.omega = Math.sign(b.omega) * Math.max(0, Math.abs(b.omega) - spinDecay * dt);
        }
        if (b.vx !== 0 || b.vy !== 0) { b.x += b.vx * dt; b.y += b.vy * dt; }
        continue;
      }
      if (b.vx === 0 && b.vy === 0 && b.omega === 0) continue;
      if (b.omega !== 0) {
        if (b.vx !== 0 || b.vy !== 0) {
          let curve;
          if (b.launchSpin && b.omega * b.launchSpin > 0) {
            curve = b.curveFactor ?? SKATER_CURVE;
          } else {
            const cm = b.curveMult || 1;
            curve = ((b.curveFactor ?? SKATER_CURVE) / cm) * TRUE_GLIDE.involuntaryCurve / (cm > 1 ? cm : 1);
          }
          const angle = b.omega * curve * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = b.vx;
          b.vx = vx * cos - b.vy * sin; b.vy = vx * sin + b.vy * cos;
        }
        if (settledSpin < 0) settledSpin = checkSettledSpin();
        const spinDecay = settledSpin ? SETTLED_SPIN_DECAY : SPIN_DECAY;
        b.rotation += b.omega * dt;
        b.omega = Math.sign(b.omega) * Math.max(0, Math.abs(b.omega) - spinDecay * dt);
      }
      if (b.vx !== 0 || b.vy !== 0) {
        b.x += b.vx * dt; b.y += b.vy * dt;
      }
    }
    if (std7 && !host && (ball.vx !== 0 || ball.vy !== 0 || ball.omega !== 0)) {
      if (ball.omega !== 0) {
        if (ball.vx !== 0 || ball.vy !== 0) {
          const angle = ball.omega * ballCurveFactor(ball) * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = ball.vx;
          ball.vx = vx * cos - ball.vy * sin; ball.vy = vx * sin + ball.vy * cos;
        }
        if (settledSpin < 0) settledSpin = checkSettledSpin();
        const spinDecay = settledSpin ? SETTLED_SPIN_DECAY : SPIN_DECAY;
        ball.rotation += ball.omega * dt;
        ball.omega = Math.sign(ball.omega) * Math.max(0, Math.abs(ball.omega) - spinDecay * dt);
      }
      if (ball.vx !== 0 || ball.vy !== 0) {
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      }
    }

    let drafts = null;
    if (dt > 0) {
      let leadCount = 0, followCount = 0;
      const pureSkaters = std7 || !ball;
      if (pureSkaters && skaterEnd <= 8) {
        for (let i = 0; i < skaterEnd; i++) {
          const b = bodies[i];
          if (!b.carded) {
            const v2 = b.vx * b.vx + b.vy * b.vy;
            scratchV2[i] = v2;
            scratchSpeed[i] = 0;
            if (v2 >= TAILGATE_MIN_FOLLOW2) {
              followCount++;
              if (v2 >= TAILGATE_MIN_LEAD2) leadCount++;
            }
          } else {
            scratchV2[i] = 0;
          }
        }
        if (leadCount > 0 && followCount >= 2) {
          drafts = spareDrafts && spareDrafts.length >= count ? spareDrafts : new Float64Array(count);
          spareDrafts = null;
          for (let i = 0; i < skaterEnd; i++) {
            drafts[i] = scratchV2[i] >= TAILGATE_MIN_FOLLOW2 ? skaterDraftAt(bodies, skaterEnd, i, bodies[i]) : 0;
          }
        }
      } else {
        for (let i = 0; i < count; i++) {
          const b = bodies[i];
          if (b.team >= 0 && !b.carded) {
            const v2 = b.vx * b.vx + b.vy * b.vy;
            if (v2 >= TAILGATE_MIN_FOLLOW2) {
              followCount++;
              if (v2 >= TAILGATE_MIN_LEAD2) leadCount++;
            }
          }
        }
        if (leadCount > 0 && followCount >= 2) {
          drafts = spareDrafts && spareDrafts.length >= count ? spareDrafts : new Float64Array(count);
          spareDrafts = null;
          for (let i = 0; i < count; i++) {
            const b = bodies[i];
            drafts[i] = (b.team >= 0 && !b.carded && b.vx * b.vx + b.vy * b.vy >= TAILGATE_MIN_FOLLOW2) ? tailgateFactor(bodies, b) : 0;
          }
        }
      }
    }

    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (!std7 && b === ball) {
        if (host) {
          const off = b.stickOffset || { x: host.radius + b.radius, y: 0 };
          b.x = host.x + off.x; b.y = host.y + off.y;
          b.vx = host.vx; b.vy = host.vy; b.omega = host.omega;
        } else if (b.vx !== 0 || b.vy !== 0) {
          const speed2 = b.vx * b.vx + b.vy * b.vy, decel = (b.friction + AIR_DRAG * speed2) * dt;
          if (speed2 <= decel * decel) { b.vx = b.vy = 0; }
          else { const sp = Math.sqrt(speed2), f = Math.max(0, sp - decel) / sp; b.vx *= f; b.vy *= f; }
        }
        continue;
      }
      if (b.vx !== 0 || b.vy !== 0) {
        const draft = drafts ? drafts[i] : 0;
        const carrying = b.holding ? SUPER.carryFriction : (b.superActive === 'stalwart' ? SUPER.stalwartFriction : 1);
        const effFriction = draft > 0 ? b.friction * carrying * (1 - TAILGATE.frictionCut * draft) : b.friction * carrying;
        const speed2 = b.vx * b.vx + b.vy * b.vy, deceleration = effFriction * dt;
        if (speed2 <= deceleration * deceleration) {
          b.vx = b.vy = 0;
        } else {
          const speed = Math.sqrt(speed2);
          const factor = Math.max(0, speed - deceleration) / speed;
          b.vx *= factor; b.vy *= factor;
        }
      }
    }
    if (std7) {
      if (host) {
        const off = ball.stickOffset || { x: host.radius + ball.radius, y: 0 };
        ball.x = host.x + off.x; ball.y = host.y + off.y;
        ball.vx = host.vx; ball.vy = host.vy; ball.omega = host.omega;
      } else if (ball.vx !== 0 || ball.vy !== 0) {
        const speed2 = ball.vx * ball.vx + ball.vy * ball.vy, deceleration = (ball.friction + AIR_DRAG * speed2) * dt;
        if (speed2 <= deceleration * deceleration) {
          ball.vx = ball.vy = 0;
        } else {
          const speed = Math.sqrt(speed2);
          const factor = Math.max(0, speed - deceleration) / speed;
          ball.vx *= factor; ball.vy *= factor;
        }
      }
    }
    if (drafts) spareDrafts = drafts;

    if (ball && (ball.vx !== 0 || ball.vy !== 0 || ball.pace || ball.onFire || ball.fireTicks)) {
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy), pace = ball.pace || 0;
      ball.pace = Math.max(speed, pace - (ball.friction + AIR_DRAG * pace * pace) * dt);
      const share = ball.pace / BASE_LAUNCH_SPEED;
      if (ball.onFire) {
        if (share <= HEAT.sustain) { ball.onFire = false; ball.fireTicks = 0; }
      } else {
        if (share > HEAT.fire) ball.fireTicks = Math.min(FIRE_TICKS, (ball.fireTicks || 0) + 1);
        else if (share <= HEAT.sustain) ball.fireTicks = 0;
        if (ball.fireTicks >= FIRE_TICKS && speed > HEAT.fire * BASE_LAUNCH_SPEED) ball.onFire = true;
      }
    }

    const hit = spareRadii && spareRadii.length >= count ? spareRadii : new Float64Array(count);
    spareRadii = null;
    if (std7) {
      for (let i = 0; i < 6; i++) {
        const s = bodies[i], r = s.radius, rc = s.reach || r, m = r >= rc ? r : rc;
        hit[i] = m >= 18 ? m : 18;
      }
      hit[6] = ball.radius >= 18 ? ball.radius : 18;
    } else {
      for (let i = 0; i < count; i++) hit[i] = ballHitRadius(bodies[i]);
    }
    const ballIdx = ball ? (std7 ? 6 : bodies.indexOf(ball)) : -1;
    const stdRink = rink.left === 60 && rink.right === 940 && rink.top === 60 && rink.bottom === 540 && rink.corner === 100;

    for (let pass = 0; pass < 3; pass++) {
      const resolvedBefore = resolved;
      // 1. Skater-vs-skater contacts.
      for (let i = 0; i < skaterEnd; i++) {
        if (!std7 && i === ballIdx) continue;
        const a = bodies[i], ax = a.x, ay = a.y, ar = a.radius;
        for (let j = i + 1; j < skaterEnd; j++) {
          if (!std7 && j === ballIdx) continue;
          const c = bodies[j], reach = ar + c.radius;
          const dx = ax - c.x, dy = ay - c.y;
          if (dx * dx + dy * dy > reach * reach) continue;
          collide(a, c, onCollide, bodies, onShockwave, guardedOnSuper);
        }
      }
      // 2. Skater-vs-ball contacts.
      if (ball) {
        if (resolved !== resolvedBefore) {
          host = holder(bodies);
          if (std7) {
            for (let i = 0; i < 6; i++) {
              const s = bodies[i], r = s.radius, rc = s.reach || r, m = r >= rc ? r : rc;
              hit[i] = m >= 18 ? m : 18;
            }
          } else {
            for (let i = 0; i < count; i++) hit[i] = ballHitRadius(bodies[i]);
          }
        }
        const bh = hit[ballIdx];
        let firstIdx = -1, multi = null;
        for (let i = 0; i < skaterEnd; i++) {
          if (!std7 && i === ballIdx) continue;
          const s = bodies[i];
          if (s.carded || s.holding) continue;
          const reach = hit[i] + bh, dx = s.x - ball.x, dy = s.y - ball.y;
          if (dx * dx + dy * dy > reach * reach) continue;
          if (firstIdx < 0) firstIdx = i;
          else { (multi ??= [firstIdx]).push(i); }
        }
        if (multi && !host) {
          const stickyTeams = new Set();
          for (const idx of multi) if (bodies[idx].superActive === 'sticky') stickyTeams.add(bodies[idx].team);
          if (stickyTeams.size > 1) {
            for (const idx of multi) if (bodies[idx].superActive === 'sticky') { bodies[idx].superHit = true; endSuper(bodies[idx], bodies); }
          }
          const anySticky = multi.some(idx => bodies[idx].superActive === 'sticky');
          if (anySticky) {
            for (const idx of multi) {
              const a = idx < ballIdx ? bodies[idx] : ball, c = idx < ballIdx ? ball : bodies[idx];
              collide(a, c, onCollide, bodies, onShockwave, guardedOnSuper);
            }
          } else {
            let keBudget = bodyKE(ball);
            for (const idx of multi) keBudget += bodyKE(bodies[idx]);
            const ball0 = { ...ball };
            let sumDx = 0, sumDy = 0, sumDvx = 0, sumDvy = 0, sumDomega = 0;
            let energySource = false, anyFireOff = false, anyFireOn = false, maxPace = 0;
            const strikerTeams = new Set(), strikerSlots = new Set();
            let lastStrikerPower = ball0.strikerPower, lastStrikerSynergy = ball0.strikerSynergy ?? 1, lastCurveMult = ball0.curveMult;
            const collideEvents = [], ironSavers = [], superEvents = [];
            for (const idx of multi) {
              const s = bodies[idx], bClone = { ...ball0 };
              const a = idx < ballIdx ? s : bClone, c = idx < ballIdx ? bClone : s;
              const hadCannon = s.superActive === 'cannonball';
              const sDrive = (s.vx * (ball0.x - s.x) + s.vy * (ball0.y - s.y)) / (Math.hypot(ball0.x - s.x, ball0.y - s.y) || 1);
              if (hadCannon || (ballOnFire(ball0) && s.team === ball0.strikerTeam && sDrive >= HOT_DRIVE)) energySource = true;
              collide(
                a, c,
                ev => {
                  if (ev.iron) ironSavers.push(s);
                  if (onCollide) collideEvents.push([ev.a === bClone ? ball : ev.a, ev.b === bClone ? ball : ev.b, ev.speed, ev.impulse, ev.plow, ev.iron, ev.checker, ev.snapped, ev.spinStruck, ev.tangentImpulse, ev.passerSlot]);
                },
                bodies,
                null,
                guardedOnSuper ? (k, act, sa, sb) => superEvents.push([k, act, sa === bClone ? ball : sa, sb === bClone ? ball : sb]) : null,
                true
              );
              sumDx += bClone.x - ball0.x; sumDy += bClone.y - ball0.y;
              sumDvx += bClone.vx - ball0.vx; sumDvy += bClone.vy - ball0.vy;
              sumDomega += bClone.omega - ball0.omega;
              if (ball0.onFire && !bClone.onFire) anyFireOff = true;
              if (!ball0.onFire && bClone.onFire) anyFireOn = true;
              if ((bClone.pace || 0) > maxPace) maxPace = bClone.pace || 0;
              if ((bClone.strikerTeam !== ball0.strikerTeam || bClone.strikerSlot !== (ball0.strikerSlot ?? -1)) && bClone.strikerTeam >= 0) {
                strikerTeams.add(bClone.strikerTeam);
                if (bClone.strikerSlot >= 0) strikerSlots.add(bClone.strikerSlot);
                lastStrikerPower = bClone.strikerPower;
                lastStrikerSynergy = bClone.strikerSynergy ?? 1;
                lastCurveMult = bClone.curveMult;
              }
            }
            ball.openingShot = false;
            ball.x = ball0.x + sumDx; ball.y = ball0.y + sumDy;
            ball.vx = ball0.vx + sumDvx; ball.vy = ball0.vy + sumDvy;
            ball.omega = Math.max(-24, Math.min(24, ball0.omega + sumDomega));
            if (!energySource) {
              let skaterKEAfter = 0;
              for (const idx of multi) skaterKEAfter += bodyKE(bodies[idx]);
              const maxBallKE = Math.max(0, keBudget - skaterKEAfter);
              const curBallKE = bodyKE(ball);
              if (curBallKE > maxBallKE && curBallKE > 0) {
                const scale = Math.sqrt(maxBallKE / curBallKE);
                ball.vx *= scale; ball.vy *= scale; ball.omega *= scale;
              }
            }
            if (anyFireOff && !anyFireOn) { ball.onFire = false; ball.fireTicks = 0; }
            else if (anyFireOn) { ball.onFire = true; ball.fireTicks = FIRE_TICKS; }
            if (strikerTeams.size === 1) {
              [ball.strikerTeam] = strikerTeams;
              ball.strikerSlot = strikerSlots.size === 1 ? [...strikerSlots][0] : -1;
              ball.strikerPower = lastStrikerPower;
              ball.strikerSynergy = lastStrikerSynergy;
              ball.curveMult = lastCurveMult;
            } else if (strikerTeams.size > 1) {
              clearStriker(ball);
            }
            const postSpeed = Math.hypot(ball.vx, ball.vy);
            ball.pace = strikerTeams.size === 1 && ball.strikerTeam === ball0.strikerTeam ? Math.max(postSpeed, maxPace) : postSpeed;
            for (const saver of ironSavers) {
              hit[bodies.indexOf(saver)] = ballHitRadius(saver);
              triggerIronShockwave(saver, bodies, onShockwave);
            }
            for (const args of superEvents) guardedOnSuper(...args);
            for (const args of collideEvents) emitCollide(onCollide, ...args);
          }
        } else if (multi && host) {
          for (const idx of multi) {
            const a = idx < ballIdx ? bodies[idx] : ball, c = idx < ballIdx ? ball : bodies[idx];
            collide(a, c, onCollide, bodies, onShockwave, guardedOnSuper);
          }
        } else if (firstIdx >= 0) {
          const a = firstIdx < ballIdx ? bodies[firstIdx] : ball, c = firstIdx < ballIdx ? ball : bodies[firstIdx];
          collide(a, c, onCollide, bodies, onShockwave, guardedOnSuper);
        }
      }
      if (resolved !== resolvedBefore) {
        if (std7) {
          for (let i = 0; i < 6; i++) {
            const s = bodies[i], r = s.radius, rc = s.reach || r, m = r >= rc ? r : rc;
            hit[i] = m >= 18 ? m : 18;
          }
        } else {
          for (let i = 0; i < count; i++) hit[i] = ballHitRadius(bodies[i]);
        }
      }
      for (let i = 0; i < skaterEnd; i++) {
        const b = bodies[i];
        if (!std7 && b.team === -1) continue;
        const r = b.radius;
        if (!stdRink || r > 90 || b.x < 150 || b.x > 850 || b.y < 60 + r || b.y > 540 - r) walls(b, onWall);
      }
      if (ball) {
        if (resolved !== resolvedBefore) host = holder(bodies);
        if (host) {
          const off = ball.stickOffset || { x: host.radius + ball.radius, y: 0 };
          const ex = host.x + off.x, ey = host.y + off.y;
          ball.x = ex; ball.y = ey;
          ball.vx = host.vx; ball.vy = host.vy; ball.omega = host.omega;
          walls(ball, onWall, host);
          const dx = ball.x - ex, dy = ball.y - ey;
          if (dx !== 0 || dy !== 0) {
            if (host.superActive !== 'stalwart') {
              host.x += dx; host.y += dy;
              host.vx = ball.vx; host.vy = ball.vy;
              walls(host, onWall);
            }
            const ox = ball.x - host.x, oy = ball.y - host.y, od = Math.hypot(ox, oy) || 1;
            const td = host.radius + ball.radius;
            ball.stickOffset = { x: (ox / od) * td, y: (oy / od) * td };
            ball.x = host.x + ball.stickOffset.x;
            ball.y = host.y + ball.stickOffset.y;
            walls(ball, onWall, host);
          }
        } else {
          const br = ball.radius;
          if (!stdRink || br > 90 || ball.x < 150 || ball.x > 850 || ball.y < 60 + br || ball.y > 540 - br) walls(ball, onWall);
        }
      }
      if (resolved === resolvedBefore) break;
    }
    spareRadii = hit;
    if (ball) {
      const inGoalY = ball.y >= rink.goalTop && ball.y <= rink.goalBottom;
      if (inGoalY) {
        if (ball.x - ball.radius <= rink.left - rink.goalDepth + 1 || ball.x + ball.radius < rink.left) return 1;
        if (ball.x + ball.radius >= rink.right + rink.goalDepth - 1 || ball.x - ball.radius > rink.right) return 0;
      }
    }
    return null;
  }

  const ZERO_PLAN = Object.freeze({ angle: 0, power: 0, spin: 0 });
  function launch(bodies, plans) {
    const count = bodies.length;
    const std7 = count === 7 && bodies[6].team === -1;
    const skaterEnd = std7 ? 6 : count;
    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (!std7 && b.team < 0) { b.spinStrike = 0; continue; }
      b.spinStrike = 0;
      syncEffectiveStats(b);
      if (b.stunned) {
        b.vx = 0; b.vy = 0; b.omega = 0;
        b.daze = 0;
        continue;
      }
      if (b.guarding) {
        b.vx *= GUARD_BRAKE; b.vy *= GUARD_BRAKE; b.omega *= GUARD_BRAKE; b.daze = 0;
        continue;
      }
      const plan = plans[i] || ZERO_PLAN;
      const spinInput = Math.max(-1, Math.min(1, plan.spin || 0));
      const full = launchSpeed(b) * carveDriveBoost(b, spinInput), power = Math.max(0, Math.min(1, plan.power));
      b.daze = 0;
      if (power > 0) {
        const dx = Math.cos(plan.angle) * full * power - b.vx, dy = Math.sin(plan.angle) * full * power - b.vy;
        const prevSpeed = Math.hypot(b.vx, b.vy);
        const reSteerMult = (b.sizeMult || 1) ** SIZE.agility * ((b.grip ?? .3) / .3) ** ICE_BITE.gripCutExp;
        const effSteer = 1 + Math.min(1, prevSpeed / (full || 1)) * (reSteerMult - 1);
        const scale = Math.min(1, (full * effSteer) / (Math.hypot(dx, dy) || 1));
        b.vx += dx * scale; b.vy += dy * scale;
        b.omega = Math.max(-b.maxSpin, Math.min(b.maxSpin, b.omega + spinInput * b.maxSpin));
        b.launchSpin = spinInput !== 0 ? b.omega : (b.launchSpin && b.omega * b.launchSpin > 0 ? b.omega : 0);
        if (b.omega) b.spinStrike = STRIKE_GAIN;
      }
    }
    const ball = std7 ? bodies[6] : bodies.find(b => b.team === -1);
    if (ball) {
      if (std7) ball.spinStrike = 0;
      let anySpinStrike = false;
      for (let i = 0; i < skaterEnd; i++) {
        const b = bodies[i];
        if (!b.spinStrike) continue;
        anySpinStrike = true;
        const gap = Math.max(0, Math.hypot(b.x - ball.x, b.y - ball.y) - ballHitRadius(b) - ball.radius);
        const proximity = Math.max(0, 1 - gap / (4 * ball.radius));
        b.spinStrike += (CLOSE_SPIN_GAIN - STRIKE_GAIN) * proximity * proximity * (3 - 2 * proximity);
      }
      ball.openingShot = anySpinStrike;
    }
  }
  function holder(bodies) {
    const limit = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
    for (let i = 0; i < limit; i++) if (bodies[i].holding) return bodies[i];
    return null;
  }
  function settled(bodies, ignoreBall = false) {
    const count = bodies.length;
    if (count === 7 && bodies[6].team === -1) {
      if (!ignoreBall) {
        const ball = bodies[6];
        if (ball.vx * ball.vx + ball.vy * ball.vy >= 4 || Math.abs(ball.omega) >= .05) return false;
      }
      for (let i = 5; i >= 0; i--) {
        const b = bodies[i];
        if (b.vx * b.vx + b.vy * b.vy >= 4 || Math.abs(b.omega) >= .05 ||
            (b.superActive === 'colossus' && colossusProgress(b) < 1)) return false;
      }
      return true;
    }
    for (let i = count - 1; i >= 0; i--) {
      const b = bodies[i];
      if (ignoreBall && b.team === -1) continue;
      if (b.vx * b.vx + b.vy * b.vy >= 4 || Math.abs(b.omega) >= .05 ||
          (b.team >= 0 && b.superActive === 'colossus' && colossusProgress(b) < 1)) return false;
    }
    return true;
  }
  function stop(bodies, keepMotion = false) {
    const count = bodies.length;
    const std7 = count === 7 && bodies[6].team === -1;
    for (let i = 0; i < count; i++) {
      const b = bodies[i];
      b.spinStrike = 0;
      b.openingShot = false;
      b.guarding = false; b.ironGuard = false; b.ironCooldownTicks = 0;
      b.stunned = false;
      if (!keepMotion) { b.vx = b.vy = b.omega = 0; if (b.team >= 0) b.launchSpin = 0; }
      if (!keepMotion || (!b.superActive && b.usedSuperThisTurn && !b.superRefunded)) endSuper(b, bodies);
      syncEffectiveStats(b);
    }
    const ball = std7 ? bodies[6] : bodies.find(b => b.team === -1);
    if (ball && !keepMotion) {
      ball.stickOffset = null;
      clearHeat(ball);
      clearStriker(ball);
    }
  }
  function stepPostGoal(bodies, dt = DT, onCollide = null, onWall = null, onShockwave = null, onSuper = null) {
    const ball = bodies.find(b => b.team === -1);
    const px = ball ? ball.x : 0, py = ball ? ball.y : 0;
    if (ball) {
      if (ball.stickOffset !== null) {
        ball.stickOffset = null;
        for (const b of bodies) if (b.holding) b.holding = false;
      }
      ball.vx = 0; ball.vy = 0; ball.omega = 0;
    }
    const skaters = ball ? bodies.filter(b => b !== ball) : bodies;
    step(skaters, dt, onCollide, onWall, onShockwave, onSuper);
    if (ball) {
      ball.x = px; ball.y = py;
      ball.vx = 0; ball.vy = 0; ball.omega = 0;
    }
  }
  function ballRun(bodies, { removed = null, boards = false, ticks = 960 } = {}) {
    const sim = [];
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b === removed) continue;
      sim.push(b.team === -1 ? { ...b } : { ...b, holding: false });
    }
    const ball = sim.length > 0 && sim[sim.length - 1].team === -1 ? sim[sim.length - 1] : sim.find(b => b.team === -1);
    let clean = Boolean(ball), distance = 0;
    const onCol = ({ a, b }) => { if (a === ball || b === ball) clean = false; };
    const onWl = (b, velocity, type) => { if (b === ball && type === 'wall' && !boards) clean = false; };
    for (let t = 0; t < ticks && clean; t++) {
      const x = ball.x, y = ball.y;
      const goal = step(sim, DT, onCol, onWl);
      if (clean) distance += Math.hypot(ball.x - x, ball.y - y);
      if (goal !== null) return { goal: clean ? goal : null, distance };
      if (!ball.vx && !ball.vy) break;
    }
    return { goal: null, distance };
  }
  function wouldScore(bodies, removed, ticks = 960) { return ballRun(bodies, { removed, ticks }).goal; }
  function cpuPlans(bodies, random = Math.random, scores = [0, 0]) {
    const CPU = typeof module === 'object' && module.exports ? require('../shared/ububall-cpu.js') : root.ububallCPU;
    return (CPU?.cpuPlans || CPU?.baseline)(bodies, random, scores);
  }
  function startTurn(bodies, plans, onSuper = null) {
    const count = bodies.length;
    const skaterEnd = count === 7 && bodies[6].team === -1 ? 6 : count;
    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (b.team < 0) continue;
      if (b.stunned && b.superActive) endSuper(b, bodies);
      const pl = plans[i];
      b.guarding = Boolean(pl?.guard) && !b.stunned;
      b.ironGuard = false;
      b.ironCooldownTicks = 0;
      b.usedSuperThisTurn = Boolean(b.superActive);
      if (!b.stunned && (b.superArm || pl?.superArm) && b.meter >= 100) {
        b.usedSuperThisTurn = true;
        b.meter = 0;
        b.superActive = b.equippedSuper.key;
        const bonusTicks = b.equippedSuper?.bonusTicks ?? b.superBonusTicks ?? 0;
        b.superTicks = SUPER.ticks + bonusTicks;
        b.superHoldTicks = SUPER.holdTicks + bonusTicks;
        if (b.superArm !== undefined) b.superArm = false;
        b.superHit = false;
        b.superRefunded = false;
        const sa = b.superActive;
        if (sa === 'stalwart' || sa === 'colossus' || sa === 'ghost') onSuper?.(sa, 'launch', b);
      }
      syncEffectiveStats(b);
    }
    launch(bodies, plans);
  }
  const PREDICTION_TICKS = 480;
  function predictTurn(bodies, plans) {
    const sim = bodies.map(b => ({
      ...b,
      stickOffset: b.stickOffset ? { x: b.stickOffset.x, y: b.stickOffset.y } : b.stickOffset,
      equippedSuper: b.equippedSuper ? { ...b.equippedSuper } : b.equippedSuper
    }));
    const held = { angle: 0, power: 0, spin: 0 };
    const predictedPlans = sim.map((b, i) => {
      if (b.team === 0) return plans[i] || held;
      if (b.team > 0 && b.superArm !== undefined) b.superArm = false;
      return held;
    });
    startTurn(sim, predictedPlans);
    const paths = sim.map(b => [{ x: b.x, y: b.y, tick: 0 }]);
    const impacts = [], lastImpact = new Map(), guards = new Map(), ball = sim.find(b => b.team === -1), ballIndex = sim.indexOf(ball);
    let goal = null, ticks = 0, ignition = null, burning = ballOnFire(ball);
    let goalTargets = null, goalTick = null;
    function recordImpact(b) {
      const index = sim.indexOf(b), last = lastImpact.get(index);
      if (last && (ticks - last.tick < 12 || Math.hypot(b.x - last.x, b.y - last.y) < 8)) return;
      const marker = { index, x: b.x, y: b.y, radius: b.radius, reach: b.team < 0 ? b.radius : Math.max(b.radius, b.reach || b.radius), tick: ticks };
      lastImpact.set(index, marker);
      impacts.push(marker);
    }
    let preStepBallSpeed = 0;
    const onCollide = ({ a, b, plow, iron }) => {
      recordImpact(a); recordImpact(b);
      const ubu = a === ball ? b : b === ball ? a : null, index = ubu ? sim.indexOf(ubu) : -1;
      if (ubu?.guarding && !guards.has(index) && (plow || iron || (ballOnFire(ball) && preStepBallSpeed > 50))) guards.set(index, !plow);
    };
    for (let tick = 1; tick <= PREDICTION_TICKS; tick++) {
      ticks = tick;
      preStepBallSpeed = ball ? Math.hypot(ball.vx, ball.vy) : 0;
      if (goal !== null) {
        stepPostGoal(sim, DT, onCollide, recordImpact);
      } else {
        const stepGoal = step(sim, DT, onCollide, recordImpact);
        if (stepGoal !== null) {
          goal = stepGoal;
          goalTick = tick;
          goalTargets = sim.map((b, i) => ({ x: b.x, y: b.y, index: i, team: b.team }));
          if (ball && ballIndex >= 0) paths[ballIndex].push({ x: ball.x, y: ball.y, tick });
        }
      }
      if (ball && !burning && ballOnFire(ball)) { burning = true; ignition = { x: ball.x, y: ball.y, tick, team: ball.strikerTeam }; }
      const done = settled(sim, goal !== null) || tick === PREDICTION_TICKS;
      if (tick % 4 === 0 || done) {
        sim.forEach((b, i) => {
          if (goal !== null && b === ball) return;
          paths[i].push({ x: b.x, y: b.y, tick });
        });
      }
      if (done) break;
    }
    return { paths, impacts, stops: sim.map((b, index) => ({ index, x: b.x, y: b.y, stopped: b.vx * b.vx + b.vy * b.vy < 4 })), ticks, goal, horizon: PREDICTION_TICKS,
      guards: [...guards].map(([index, held]) => ({ index, held })), ignition, goalTargets, goalTick };
  }
  const api = { VERSION, rink, DT, BASE_LAUNCH_SPEED, IMPULSE, SKATER_CURVE, SPIN_DECAY, SETTLED_SPIN_DECAY, AIR_DRAG, SURFACES, SUPERS, DAZE, SIZE, ICE_BITE, CARVE_DRIVE, TRUE_GLIDE, TEMPERED_SHOT, SWEET_SPOT, BOARD_SPRING, TAPE_TO_TAPE, PACK_DRAFT, SUPER, HEAT, FIRE_TICKS, IRON_COOLDOWN_TICKS, SNAP, RIM, TAILGATE, HIP_CLIP, tailgateFactor, carveDriveBoost, ballOnFire, ballCurveFactor, holder, dazeSlow, multiplier, launchSpeed, syncEffectiveStats, applyStats, applyDoubledGuard, spawn, makeUbu, makeBall, setStriker, clearStriker, clearHeat, kickoff, endSuper, superMastery, step, stepPostGoal, launch, settled, stop, ballRun, wouldScore, triggerShockwave, triggerIronShockwave, cpuPlans, startTurn, predictTurn };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallPhysics = api;
})(globalThis);
