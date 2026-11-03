'use strict';
(function (root) {
  // Bump VERSION with any change to how a turn plays out (startTurn, step and their tuning): saved
  // replays re-simulate their turns and refuse a different version (docs/ububall-file.md).
  const VERSION = 11;
  const rink = Object.freeze({ left: 60, right: 940, top: 60, bottom: 540, corner: 100, goalTop: 230, goalBottom: 370, goalDepth: 38 });
  const DT = 1 / 240, MAX_SPEED = 720;
  const IMPULSE = 3 * MAX_SPEED;
  const SKATER_CURVE = .06, BALL_CURVE = .045;
  const AIR_DRAG = .00015; // Quadratic drag on the ball, strongest on fast shots; ubus have none.
  const SPIN_DECAY = 5; // Rad/s of spin every body loses each second.
  const STRIKE_GAIN = 1, CLOSE_SPIN_GAIN = 2; // Spin strike multiplier from range and at point blank.
  const STRIKE_POWER = .5; // Point-blank strike's extra ball speed at full spin, as a share of the ubu's speed.
  const GUARD_BRAKE = .25; // Share of velocity and spin a guarding ubu keeps when its turn starts.
  const WALL_BOUNCE = .82; // Share of speed into the boards that comes back out.
  // Size trade-offs (tuning): as powers of the size multiplier, small ubus launch faster, curve and
  // re-steer more and strike spin harder; big ubus lose more speed off the boards.
  const SIZE = Object.freeze({ launch: -.28, agility: -.5, strike: -.5, boards: -.5 });
  // Heat and fire tuning, as shares of MAX_SPEED (owner decisions 2026-11-01). Fire follows the ball's
  // pace: its speed with any slowing by its striking team's own ubus left out. Friction and drag slow
  // the pace as they would a free ball; boards, posts, net and an opponent's Magnet take their share
  // off it; an opponent's touch takes the ball over, leaving its pace at its real speed; it never falls
  // below the ball's real speed. The ball glows orange from a pace of 540 px/s,
  // red from 720 and red hot from 800. Heat builds while the pace is above 840 (pausing between 504 and
  // 840, lost at 504); at FIRE_TICKS (0.25 s) of heat the ball catches fire once it really moves above
  // 840, and burns until its pace drops to 504.
  const HEAT = Object.freeze({ orange: 540 / MAX_SPEED, red: 720 / MAX_SPEED, redHot: 800 / MAX_SPEED, fire: 840 / MAX_SPEED, sustain: .70 });
  const FIRE_TICKS = 60;
  // An Iron Save leaves the ball and the Guard each with this share of their speed off the hit
  // (owner decision 2026-11-01): the ball dies at the Guard's feet and the Guard holds its ground,
  // so the shooter gets no rebound and the save stays with the defence.
  const IRON_KEEP = .1;
  // A hot shot: a teammate of the striker driving into a burning ball at this speed or more (px/s,
  // toward the ball) sends it off at its pace at least, so a trapped fireball fires back at full pace.
  const HOT_DRIVE = 100;
  function ballOnFire(ball) {
    return Boolean(ball?.onFire);
  }
  // A slowing that counts against the pace takes the same share off it.
  function countSlowing(ball, before) {
    const after = Math.hypot(ball.vx, ball.vy);
    if (after < before) ball.pace = (ball.pace || 0) * after / before;
  }
  // Daze (tuning): a check that knocks an ubu by more than `speed` px/s dazes it by the excess over
  // `scale` (a neutral full-power check: 15%), divided by its Stability and at most `hit` per check.
  // Dazes stack up to `max`. Up to `free` a daze has no effect; beyond it the next launch's speed is
  // cut, rising evenly to `max` at the cap, so one hard check shrugs off but repeated ones tell.
  const DAZE = Object.freeze({ speed: 250, scale: 2850, hit: .2, free: .15, max: .4 });
  function daze(body, knock) {
    if (knock > DAZE.speed) body.daze = Math.min(DAZE.max, (body.daze || 0) + Math.min(DAZE.hit, (knock - DAZE.speed) / DAZE.scale / (body.stability || 1)));
  }
  function dazeSlow(body) {
    const daze = body.daze || 0;
    return daze <= DAZE.free ? 0 : (daze - DAZE.free) / (DAZE.max - DAZE.free) * DAZE.max;
  }
  // Super tuning: every super lasts SUPER.ticks of play (3 s) or until spent, carrying across Pulse
  // turns. Sticky lets go after holdTicks or when an opponent hits the carrier, who skates with
  // carryFriction × friction meanwhile. Magnet pulls within magnetRadius, up to magnetPull px/s² at
  // contact. Shockwave fires on an opponent or when its time runs out, pushing within shockRadius;
  // teammates feel shockTeammate of it. Cannonball adds cannonball × the ball impulse. Colossus
  // grows by colossusRadius and colossusMass.
  const SUPER = Object.freeze({ ticks: 720, holdTicks: 480, carryFriction: 1.5, magnetRadius: 190, magnetPull: 1000,
    shockRadius: 170, shockForce: 1100, shockTeammate: .4, shockRepel: 550, cannonball: 1,
    colossusRadius: 1.8, colossusMass: 1.8, colossusLaunch: 0.75,
    stalwartLaunch: 0.5, stalwartFriction: 3.0, whiffRefund: 25 });
  function ballHitRadius(body) { return Math.max(body.radius, body.reach || body.radius, 18); }
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
  // Super Mastery (duplicate DNA super slots): 1 copy = Base (no suffix, +0s, +0%), 2 copies = Level 2 (' II', +0.5s, +5%),
  // 3 copies = Level 3 (' III', +1.0s, +10%), 4 copies = Master (' Master', +2.0s, +20%).
  function superMastery(supers, superId) {
    if (superId == null) return { level: 1, copies: 1, suffix: '', displayName: '', bonusTicks: 0, bonusRefund: 0 };
    const copies = Array.isArray(supers) ? supers.filter(s => (s % 8) === superId).length : 1;
    const base = SUPERS[superId] || { name: 'Super' };
    if (copies >= 4) return { level: 4, copies, suffix: ' Master', displayName: base.name + ' Master', bonusTicks: 480, bonusRefund: 20 };
    if (copies === 3) return { level: 3, copies, suffix: ' III', displayName: base.name + ' III', bonusTicks: 240, bonusRefund: 10 };
    if (copies === 2) return { level: 2, copies, suffix: ' II', displayName: base.name + ' II', bonusTicks: 120, bonusRefund: 5 };
    return { level: 1, copies: Math.max(1, copies), suffix: '', displayName: base.name, bonusTicks: 0, bonusRefund: 0 };
  }
  function multiplier(raw) {
    if (!Number.isInteger(raw) || raw < 0 || raw > 255) throw new RangeError('Stat must be an integer from 0 to 255.');
    // Exponential: every stat point changes the result by the same percentage, so mid-range
    // stats matter as much as extremes. 0 = 2/3×, 127 = 1×, 255 = 1.5×.
    return raw < 127 ? (2 / 3) ** ((127 - raw) / 127) : 1.5 ** ((raw - 127) / 128);
  }
  // Full-launch speed comes from Impulse, not Mass, so a heavier ubu launches as fast and carries more
  // momentum into the ball and opponents. Only weight added on top of its own (Colossus) slows it.
  // Smaller ubus launch a little faster, and a daze from heavy checks slows the next launch.
  function launchSpeed(body) {
    const superScale = (body.colossusApplied || body.superActive === 'colossus') ? SUPER.colossusLaunch
      : (body.superActive === 'stalwart' ? SUPER.stalwartLaunch
      : (body.baseMass || body.mass) / body.mass);
    return (body.impulse || IMPULSE) / 3 * superScale * (body.sizeMult || 1) ** SIZE.launch * (1 - dazeSlow(body));
  }
  function applyStats(body, raw = {}) {
    // Mass spans a narrower range than other stats (0.82–1.22×, tuning): weight helps every shot,
    // check and block without a launch-speed cost, so a full 2/3–1.5× span dominated.
    body.mass = 3 * Math.sqrt(multiplier(raw.mass ?? 127));
    body.sizeMult = multiplier(raw.size ?? 127);
    body.radius = 25 * body.sizeMult;
    body.baseMass = body.mass;
    body.baseRadius = body.radius;
    // Traction spans a narrower range than most stats (0.75–1.33×, tuning): stopping where you aim
    // was the strongest stat.
    body.friction = 150 * multiplier(raw.traction ?? 127) ** .7;
    body.maxSpin = 10 * multiplier(raw.spin ?? 127);
    body.grip = .3 * multiplier(raw.grip ?? 127);
    body.impulse = IMPULSE * multiplier(raw.impulse ?? 127);
    // Curve bends the ubu's own path (more for small ubus) and the path of the ball it strikes, and
    // strengthens its spin strike.
    body.curveMult = multiplier(raw.curve ?? 127);
    body.curveFactor = SKATER_CURVE * body.curveMult * body.sizeMult ** SIZE.agility;
    body.bounciness = multiplier(raw.bounciness ?? 127);
    // Bounciness acts on the boards only; big ubus lose more speed off them.
    body.wallBounce = Math.min(.95, WALL_BOUNCE * body.bounciness * body.sizeMult ** SIZE.boards);
    body.power = multiplier(raw.power ?? 127);
    body.reach = Math.max(body.radius, 25 * multiplier(raw.reach ?? 127), 18);
    body.strength = multiplier(raw.strength ?? 127);
    body.stability = multiplier(raw.stability ?? 127);
  }
  // Kickoff position of a team's ubu (slot 0–2); carded ubus return here.
  function spawn(team, slot) {
    return { x: team ? (slot === 0 ? 820 : 690) : (slot === 0 ? 180 : 310), y: slot === 0 ? 300 : slot === 1 ? 180 : 420 };
  }
  function kickoff() {
    const bodies = [];
    for (let team = 0; team < 2; team++) for (let i = 0; i < 3; i++) {
      bodies.push({ ...spawn(team, i), vx: 0, vy: 0,
        radius: 25, mass: 3, friction: 150, grip: .3, maxSpin: 10, omega: 0, rotation: 0, team, slot: i });
    }
    bodies.push({ x: 500, y: 300, vx: 0, vy: 0, radius: 18, mass: 1, friction: 85, grip: .3, maxSpin: 8, curveFactor: BALL_CURVE, omega: 0, rotation: 0, team: -1, fireTicks: 0, onFire: false, pace: 0, strikerPower: 1, strikerTeam: -1 });
    return bodies;
  }
  // Counts boards and contacts resolved, so a collision pass that resolved nothing ends the passes.
  let resolved = 0;
  function reflect(b, nx, ny, penetration, wallType = 'wall', onWall = null) {
    resolved++;
    b.x -= nx * penetration; b.y -= ny * penetration;
    const velocity = b.vx * nx + b.vy * ny;
    if (velocity > 0) {
      b.spinStrike = 0; // A wall bounce spends a launching ubu's spin strike.
      const isMeteor = b.team === -1 && ballOnFire(b) && (wallType === 'wall' || wallType === 'post');
      const preSpeed = isMeteor ? Math.hypot(b.vx, b.vy) : 0;
      const rebound = 1 + (b.wallBounce ?? WALL_BOUNCE);
      b.vx -= rebound * velocity * nx; b.vy -= rebound * velocity * ny;
      const tx = -ny, ty = nx;
      const slip = b.vx * tx + b.vy * ty + b.omega * b.radius;
      const limit = b.grip * rebound * velocity * b.mass;
      const impulse = Math.max(-limit, Math.min(limit, -slip * b.mass / 3));
      b.vx += impulse * tx / b.mass; b.vy += impulse * ty / b.mass;
      b.omega += 2 * impulse / (b.mass * b.radius);
      b.omega *= 0.5; // Dampen spin on wall contact so balls don't curve right back into the wall
      if (isMeteor && preSpeed > 0) {
        const postSpeed = Math.hypot(b.vx, b.vy);
        if (postSpeed > 0) {
          const scale = preSpeed / postSpeed;
          b.vx *= scale; b.vy *= scale;
        }
      }
      if (typeof onWall === 'function') onWall(b, velocity, wallType, nx, ny);
    }
  }
  function walls(b, onWall = null) {
    const r = b.radius, k = rink;
    // Clear of every board, post and corner arc: nothing below can apply.
    if (b.x >= k.left + r && b.x <= k.right - r && b.y >= k.top + r && b.y <= k.bottom - r &&
        ((b.x >= k.left + k.corner && b.x <= k.right - k.corner) || (b.y >= k.top + k.corner && b.y <= k.bottom - k.corner))) return;
    const inGoalY = b.y > k.goalTop && b.y < k.goalBottom, before = b.team === -1 ? Math.hypot(b.vx, b.vy) : 0;

    if (inGoalY) {
      if (b.x < k.left) {
        const backX = k.left - k.goalDepth + r;
        if (b.x < backX) {
          reflect(b, -1, 0, backX - b.x, 'net', onWall);
          if (b.team === -1) { b.vx *= 0.1; b.vy *= 0.1; }
        }
        if (b.y < k.goalTop + r) reflect(b, 0, -1, k.goalTop + r - b.y, 'net', onWall);
        if (b.y > k.goalBottom - r) reflect(b, 0, 1, b.y - (k.goalBottom - r), 'net', onWall);
      } else if (b.x < k.left + r) {
        for (const y of [k.goalTop, k.goalBottom]) {
          const dx = k.left - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, r - d, 'post', onWall); }
        }
      }
    } else {
      if (b.x < k.left + r) reflect(b, -1, 0, k.left + r - b.x, 'wall', onWall);
    }

    if (inGoalY) {
      if (b.x > k.right) {
        const backX = k.right + k.goalDepth - r;
        if (b.x > backX) {
          reflect(b, 1, 0, b.x - backX, 'net', onWall);
          if (b.team === -1) { b.vx *= 0.1; b.vy *= 0.1; }
        }
        if (b.y < k.goalTop + r) reflect(b, 0, -1, k.goalTop + r - b.y, 'net', onWall);
        if (b.y > k.goalBottom - r) reflect(b, 0, 1, b.y - (k.goalBottom - r), 'net', onWall);
      } else if (b.x > k.right - r) {
        for (const y of [k.goalTop, k.goalBottom]) {
          const dx = k.right - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, r - d, 'post', onWall); }
        }
      }
    } else {
      if (b.x > k.right - r) reflect(b, 1, 0, b.x - k.right + r, 'wall', onWall);
    }

    const insidePocket = (b.x < k.left) || (b.x > k.right);
    if (!insidePocket) {
      if (b.y < k.top + r) reflect(b, 0, -1, k.top + r - b.y, 'wall', onWall);
      if (b.y > k.bottom - r) reflect(b, 0, 1, b.y - k.bottom + r, 'wall', onWall);
      const cx = b.x < k.left + k.corner ? k.left + k.corner : b.x > k.right - k.corner ? k.right - k.corner : null;
      const cy = b.y < k.top + k.corner ? k.top + k.corner : b.y > k.bottom - k.corner ? k.bottom - k.corner : null;
      if (cx !== null && cy !== null) {
        const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy, limit = k.corner - r;
        if (limit < 0 || d2 > limit * limit) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, d - limit, 'wall', onWall); }
      }
    }
    if (before) countSlowing(b, before);
  }
  function triggerShockwave(source, bodies, onShockwave) {
    const radius = SUPER.shockRadius;
    const sourceTeam = source.team;
    for (const b of bodies) {
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
    if (typeof onShockwave === 'function') onShockwave(source, radius);
  }
  function triggerIronShockwave(source, bodies, onShockwave) {
    const radius = SUPER.shockRadius * 0.5;
    const force = 400;
    for (const b of bodies) {
      if (b === source || b.superActive === 'stalwart' || b.carded) continue;
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
  // Ends a ubu's super: Colossus shrinks back, Sticky ball is let go, and mastery/whiff refunds are awarded.
  function endSuper(b, bodies) {
    if (b.colossusApplied) {
      if (b.baseRadius) b.radius = b.baseRadius;
      if (b.baseMass) b.mass = b.baseMass;
      b.colossusApplied = false;
    }
    if (b.holding) {
      b.holding = false;
      const ball = bodies?.find(o => o.team === -1);
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
  }
  function collide(a, b, onCollide = null, allBodies = null, onShockwave = null, onSuper = null) {
    const isBall = a.team === -1 || b.team === -1;
    // A carded ubu sits out its turn at its spawn, touching nothing.
    if (a.carded || b.carded) return;
    if (!isBall && a.team !== b.team && (a.superActive === 'ghost' || b.superActive === 'ghost')) return;

    if (isBall) {
      const player = a.team !== -1 ? a : b;
      const ball = a.team === -1 ? a : b;
      if (player.holding) return;
    }

    const ra = (isBall && a.team !== -1) ? ballHitRadius(a) : a.radius;
    const rb = (isBall && b.team !== -1) ? ballHitRadius(b) : b.radius;
    const dx = b.x - a.x, dy = b.y - a.y, radius = ra + rb;
    const d2 = dx * dx + dy * dy;
    if (d2 > radius * radius) return;
    resolved++;
    const d = Math.sqrt(d2);
    // Pace (see HEAT): only the striking team's own ubus slow the ball without it counting.
    const ballBody = isBall ? (a.team === -1 ? a : b) : null, ubu = ballBody && (ballBody === a ? b : a);
    const own = Boolean(ubu) && ubu.team === ballBody.strikerTeam, hot = ballOnFire(ballBody);
    const drive = ubu ? (ubu.vx * (ballBody.x - ubu.x) + ubu.vy * (ballBody.y - ubu.y)) / (d || 1) : 0;
    // Any ubu contact consumes the opening shot, even a stationary touch. Capture the striker's
    // remaining spin before contact friction changes it; no rebound can re-arm it. The bonus spins
    // the ball against the ubu, the way contact friction already does, like meshing gears.
    // Close in, the strike also drives the ball harder, in proportion to the ubu's spin and speed,
    // so a heavily spun shot still travels.
    let closeSpin = 0, strikeBoost = 0;
    if (isBall) {
      const ball = a.team === -1 ? a : b, player = a.team === -1 ? b : a;
      if (player.superActive) {
        if (['cannonball', 'sticky', 'magnet', 'ghost', 'stalwart', 'colossus'].includes(player.superActive)) {
          player.superHit = true;
        }
      }
      if (ball.openingShot && player.spinStrike) {
        // Smaller ubus strike harder; Curve passes on more spin.
        const small = (player.sizeMult || 1) ** SIZE.strike;
        closeSpin = -player.spinStrike * player.omega * small * (player.curveMult || 1);
        strikeBoost = small * STRIKE_POWER * (player.spinStrike - STRIKE_GAIN) * Math.min(1, Math.abs(player.omega) / player.maxSpin) * Math.hypot(player.vx, player.vy);
      }
      if (closeSpin && allBodies?.some(other => other.team >= 0 && other !== player && !other.carded &&
          (other.x - ball.x) ** 2 + (other.y - ball.y) ** 2 <= (ballHitRadius(other) + ball.radius) ** 2)) closeSpin = strikeBoost = 0;
      ball.openingShot = false;
    } else a.spinStrike = b.spinStrike = 0; // Touching another ubu first spends both strikes.

    let knockoutChecker = null;
    if (!isBall && a.team !== b.team) {
      if (['knockout', 'stalwart', 'colossus'].includes(a.superActive)) a.superHit = true;
      if (['knockout', 'stalwart', 'colossus'].includes(b.superActive)) b.superHit = true;
      if (a.superActive === 'knockout') { b.stunnedNext = true; a.superActive = null; onSuper?.('knockout', 'impact', a, b); knockoutChecker = a; }
      if (b.superActive === 'knockout') { a.stunnedNext = true; b.superActive = null; onSuper?.('knockout', 'impact', b, a); knockoutChecker = b; }
      // An opponent's hit knocks a Sticky ball loose.
      if (a.superActive === 'sticky' && a.holding) endSuper(a, allBodies);
      if (b.superActive === 'sticky' && b.holding) endSuper(b, allBodies);
    }

    const nx = d ? dx / d : 1, ny = d ? dy / d : 0;
    const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    // Restitution describes the rebound, not the entire stopping impulse. Bounciness acts only on
    // the boards, so every body and ball contact shares one sub-elastic rebound.
    const restitution = .88;
    // A flaming ball that beats the ubu's resistance hits as the heavier body: in the collision it
    // weighs the ubu's mass × E / R. It deflects the ubu rather than passing through, and the
    // ordinary energy bound still holds.
    let fireWin = null, ironSave = false;

    if (isBall) {
      const player = a.team !== -1 ? a : b;
      const ball = a.team === -1 ? a : b;
      if (player.superActive === 'sticky') {
        for (const o of allBodies || []) o.holding = false;
        player.holding = true; ball.stuckTicks = 0;
        onSuper?.('sticky', 'impact', player, ball);
        // An opponent's Sticky smothers the ball; a teammate's keeps it as hot as it was.
        if (!own) { ball.onFire = false; ball.fireTicks = 0; ball.pace = 0; }
        const ox = ball.x - player.x, oy = ball.y - player.y, od = Math.sqrt(ox * ox + oy * oy) || 1;
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
        if (typeof onCollide === 'function') onCollide(a, b, Math.max(0, -closing), 0);
        return;
      }
    }

    if (isBall) {
      const ball = a.team === -1 ? a : b, player = a.team === -1 ? b : a;
      if (ballOnFire(ball) && player.superActive !== 'cannonball' && closing < 0) {
        const pbx = ball.x - player.x, pby = ball.y - player.y;
        const pbDist = Math.hypot(pbx, pby) || 1;
        const pnx = pbx / pbDist, pny = pby / pbDist;
        const ballSpeed = Math.hypot(ball.vx, ball.vy);
        if (ballSpeed > 50) {
          const bux = ball.vx / ballSpeed, buy = ball.vy / ballSpeed;
          // How squarely the ball meets the ubu, from its heading against the line to the ubu's centre (1 head-on).
          // It is taken at first contact, wherever that is: Guard's longer reach must not hide it.
          const delta = Math.max(0, -(bux * pnx + buy * pny));

          let R = 0;
          if (player.superActive === 'stalwart') {
            R = Infinity;
          } else {
            const normMass = (player.baseMass || player.mass) / 3;
            const baseStab = player.guardBase ? player.guardBase.stability : (player.stability || 1);
            const guardMult = player.guarding ? 2.0 : 1.0;
            const colossusMult = player.superActive === 'colossus' ? 1.8 : 1.0;
            R = normMass * baseStab * (1 + delta * delta) * guardMult * colossusMult;
          }

          const strikerPow = ball.strikerPower || 1;
          const E = (ballSpeed / MAX_SPEED) * strikerPow * 2.8;

          if (E > R) {
            fireWin = R / E;
          } else if (player.guarding) {
            const opposing = ball.strikerTeam !== undefined && ball.strikerTeam >= 0 && ball.strikerTeam !== player.team;
            if (opposing) {
              ball.onFire = false;
              ball.fireTicks = 0;
            }
            ironSave = true;
            if (allBodies) triggerIronShockwave(player, allBodies, onShockwave);
          }
        }
      }
    }

    const invA = fireWin !== null && a.team === -1 ? fireWin / b.mass : 1 / a.mass;
    const invB = fireWin !== null && b.team === -1 ? fireWin / a.mass : 1 / b.mass;
    const inverse = invA + invB;
    if (inverse === 0) return;

    const overlap = radius - d;
    if (a.superActive === 'stalwart' && b.superActive !== 'stalwart') {
      b.x += nx * overlap; b.y += ny * overlap;
    } else if (b.superActive === 'stalwart' && a.superActive !== 'stalwart') {
      a.x -= nx * overlap; a.y -= ny * overlap;
    } else {
      const correction = overlap / inverse;
      if (invA > 0) { a.x -= nx * correction * invA; a.y -= ny * correction * invA; }
      if (invB > 0) { b.x += nx * correction * invB; b.y += ny * correction * invB; }
    }

    if (closing >= 0) return;
    if (!isBall) {
      if (a.superActive === 'stalwart') onSuper?.('stalwart', 'impact', a, b);
      if (b.superActive === 'stalwart') onSuper?.('stalwart', 'impact', b, a);
    }

    const baseImpulse = -(1 + restitution) * closing / inverse;

    let impulseA = baseImpulse, impulseB = baseImpulse;
    if (isBall) {
      if (a.team !== -1 && a.power) impulseB *= a.power;
      else if (b.team !== -1 && b.power) impulseA *= b.power;
    } else {
      const strA = a.strength || 1, stabA = a.stability || 1;
      const strB = b.strength || 1, stabB = b.stability || 1;
      impulseB *= (strA / stabB);
      impulseA *= (strB / stabA);
    }

    // Power/check stats redistribute impact energy; they cannot manufacture it.
    // Preserve tangential motion and bound only the normal collision response.
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

    // Cannonball is an explicit, single-use source of energy for the ball only.
    // Keep its extra impulse out of the ordinary collision's energy budget.
    let cannon = null, cannonImpulse = 0;
    if (isBall) {
      if (a.team !== -1 && a.superActive === 'cannonball') { cannon = a; cannonImpulse = SUPER.cannonball * impulseB; }
      else if (b.team !== -1 && b.superActive === 'cannonball') { cannon = b; cannonImpulse = -SUPER.cannonball * impulseA; }
    }

    if (invA > 0 && a.superActive !== 'stalwart') {
      a.vx -= impulseA * nx * invA; a.vy -= impulseA * ny * invA;
    }
    if (invB > 0 && b.superActive !== 'stalwart') {
      b.vx += impulseB * nx * invB; b.vy += impulseB * ny * invB;
    }
    // A hard check between opponents dazes the ubu that was hit, if knocked hard enough (see DAZE).
    // Whichever drove into the contact faster is the attacker and is not dazed by its own check; in
    // an even head-on crash both are.
    let checker = knockoutChecker;
    if (!isBall && a.team !== b.team) {
      const driveA = normalA, driveB = -normalB;
      const knockA = Math.abs(impulseA * invA), knockB = Math.abs(impulseB * invB);
      if (driveB >= driveA && knockA >= DAZE.speed && !(a.superActive === 'stalwart' || a.superActive === 'colossus')) checker = b;
      else if (driveA >= driveB && knockB >= DAZE.speed && !(b.superActive === 'stalwart' || b.superActive === 'colossus')) checker = a;
      if (driveB >= driveA) daze(a, knockA);
      if (driveA >= driveB) daze(b, knockB);
    }
    // The fireball's hit dazes the ubu it knocks aside.
    if (fireWin !== null) {
      if (a.team === -1) daze(b, Math.abs(impulseB * invB)); else daze(a, Math.abs(impulseA * invA));
    }

    // Friction works at the bodies' real masses (a fireball's extra weight is for the hit only), so
    // it can only take energy away.
    const tx = -ny, ty = nx, frictionA = 1 / a.mass, frictionB = 1 / b.mass;
    const slip = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - a.omega * a.radius - b.omega * b.radius;
    const limit = Math.sqrt(a.grip * b.grip) * baseImpulse;
    const tangent = Math.max(-limit, Math.min(limit, -slip / (3 * (frictionA + frictionB))));

    if (frictionA > 0 && a.superActive !== 'stalwart') {
      a.vx -= tangent * tx * frictionA; a.vy -= tangent * ty * frictionA;
      a.omega -= 2 * tangent * frictionA / a.radius;
    }
    if (frictionB > 0 && b.superActive !== 'stalwart') {
      b.vx += tangent * tx * frictionB; b.vy += tangent * ty * frictionB;
      b.omega -= 2 * tangent * frictionB / b.radius;
    }

    if (cannon) {
      const ball = a.team === -1 ? a : b;
      ball.vx += cannonImpulse * nx / ball.mass;
      ball.vy += cannonImpulse * ny / ball.mass;
      cannon.superActive = null;
      ball.fireTicks = FIRE_TICKS;
      ball.onFire = true;
      ball.strikerPower = cannon.power || 1;
      ball.strikerTeam = cannon.team;
      onSuper?.('cannonball', 'impact', cannon, ball);
    } else if (isBall && closing < 0 && fireWin === null) {
      const ball = a.team === -1 ? a : b, player = a.team === -1 ? b : a;
      ball.strikerPower = player.power || 1;
      ball.strikerTeam = player.team;
    }

    // The ball curves as the ubu that last struck it would: Curve shapes shots too. An ubu the
    // fireball overpowered did not strike it, so the shot keeps its striker and curve.
    if (isBall && fireWin === null) (a.team === -1 ? a : b).curveFactor = BALL_CURVE * ((a.team === -1 ? b : a).curveMult || 1);

    if (closeSpin) {
      const ball = a.team === -1 ? a : b, away = ball === b ? 1 : -1;
      ball.omega = Math.max(-24, Math.min(24, ball.omega + closeSpin));
      // The boost follows the ball's new heading, or straight off the ubu if it was stopped dead.
      const speed = Math.hypot(ball.vx, ball.vy);
      ball.vx += (speed ? ball.vx / speed : nx * away) * strikeBoost;
      ball.vy += (speed ? ball.vy / speed : ny * away) * strikeBoost;
      if (strikeBoost) ball.spinStruck = true; // Read and cleared by the caller, for a callout.
    }
    if (ironSave) {
      for (const body of [a, b]) { body.vx *= IRON_KEEP; body.vy *= IRON_KEEP; body.omega *= IRON_KEEP; }
    }
    if (ballBody) {
      const speed = Math.hypot(ballBody.vx, ballBody.vy), pace = ballBody.pace || 0;
      if (!own) ballBody.pace = speed;
      else if (hot && drive >= HOT_DRIVE && pace > speed) {
        // A hot shot leaves at the ball's pace, along its new heading or straight off the ubu.
        const ux = speed ? ballBody.vx / speed : (ballBody.x - ubu.x) / (d || 1), uy = speed ? ballBody.vy / speed : (ballBody.y - ubu.y) / (d || 1);
        ballBody.vx = ux * pace; ballBody.vy = uy * pace;
      }
    }

    if (typeof onCollide === 'function') {
      onCollide(a, b, -closing, baseImpulse, fireWin !== null, ironSave, checker);
    }
  }
  let spareRadii = new Float64Array(7); // Broad-phase scratch, taken while a step uses it.
  function step(bodies, dt = DT, onCollide = null, onWall = null, onShockwave = null, onSuper = null) {
    let stalwartHits = null;
    const guardedOnSuper = onSuper ? (key, action, a, b) => {
      if (key === 'stalwart' && action === 'impact') {
        const id = bodies.indexOf(a) * 10 + bodies.indexOf(b);
        if (stalwartHits?.has(id)) return;
        stalwartHits ??= new Set();
        stalwartHits.add(id);
      }
      onSuper(key, action, a, b);
    } : null;
    const ball = bodies.find(b => b.team === -1);
    if (ball?.openingShot) {
      // Existing contact must count before motion can separate the bodies.
      // A different ubu already touching also invalidates a close setup.
      let touching = 0, b = null;
      for (const other of bodies) {
        if (other.team >= 0 && !other.carded && (other.x - ball.x) ** 2 + (other.y - ball.y) ** 2 <= (ballHitRadius(other) + ball.radius) ** 2) { touching++; b = other; }
      }
      if (touching > 1 || (touching === 1 && !b.spinStrike)) ball.openingShot = false;
      if (touching === 1) {
        if ((ball.vx - b.vx) * (ball.x - b.x) + (ball.vy - b.vy) * (ball.y - b.y) >= 0) ball.openingShot = false;
      }
    }
    // Who holds the ball changes only in a collision (or as the hold times out, below).
    let host = ball && holder(bodies);
    if (ball && !host) {
      for (const b of bodies) {
        if (b.team !== -1 && b.superActive === 'magnet') {
          const dx = b.x - ball.x, dy = b.y - ball.y, d2 = dx * dx + dy * dy;
          const minDist = b.radius + ball.radius;
          if (d2 > minDist * minDist && d2 < SUPER.magnetRadius ** 2) {
            const d = Math.sqrt(d2);
            onSuper?.('magnet', 'pull', b);
            b.superHit = true;
            const pull = SUPER.magnetPull * (1 - d / SUPER.magnetRadius), before = Math.hypot(ball.vx, ball.vy);
            ball.vx += (dx / d) * pull * dt;
            ball.vy += (dy / d) * pull * dt;
            if (b.team !== ball.strikerTeam) countSlowing(ball, before);
          }
        }
      }
    }
    // Supers run on play time: each lasts SUPER.ticks.
    for (const b of bodies) {
      if (!b.superActive || b.team < 0 || !b.superTicks) continue;
      if (--b.superTicks > 0) continue;
      endSuper(b, bodies);
    }
    // Shockwave: opponent-only burst on first proximity, then continuous repulsion aura.
    for (const b of bodies) {
      if (b.team >= 0 && b.superActive === 'shockwave') {
        const inRange = [];
        for (const opp of bodies) {
          if (opp.team >= 0 && opp.team !== b.team && !opp.carded && opp.superActive !== 'stalwart') {
            const dx = opp.x - b.x, dy = opp.y - b.y, d2 = dx * dx + dy * dy;
            if (d2 > 0 && d2 < SUPER.shockRadius * SUPER.shockRadius) {
              inRange.push({ opp, d: Math.sqrt(d2), dx, dy });
            }
          }
        }
        if (!b.shockwaveFired) {
          if (inRange.length > 0) {
            b.shockwaveFired = true;
            b.superHit = true;
            triggerShockwave(b, bodies, onShockwave);
          }
        } else {
          for (const { opp, d, dx, dy } of inRange) {
            const repel = SUPER.shockRepel * (1 - d / SUPER.shockRadius);
            opp.vx += (dx / d) * repel * dt;
            opp.vy += (dy / d) * repel * dt;
          }
        }
      }
    }
    if (host && ++ball.stuckTicks >= (host.superHoldTicks || SUPER.holdTicks)) { endSuper(host, bodies); host = null; }
    for (const b of bodies) {
      if (b === ball && host) {
        const off = b.stickOffset || { x: host.radius + b.radius, y: 0 };
        b.x = host.x + off.x; b.y = host.y + off.y;
        b.vx = host.vx; b.vy = host.vy; b.omega = host.omega;
        continue;
      }
      // Experimental curve: rotate velocity without adding translational energy.
      const curve = b.curveFactor !== undefined ? b.curveFactor : (b.team === -1 ? BALL_CURVE : SKATER_CURVE);
      if (b.omega !== 0) {
        const angle = b.omega * curve * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = b.vx;
        b.vx = vx * cos - b.vy * sin; b.vy = vx * sin + b.vy * cos;
      }
      b.rotation += b.omega * dt;
      b.omega = Math.sign(b.omega) * Math.max(0, Math.abs(b.omega) - SPIN_DECAY * dt);
      b.x += b.vx * dt; b.y += b.vy * dt;
      const carrying = b.holding ? SUPER.carryFriction : (b.superActive === 'stalwart' ? SUPER.stalwartFriction : 1);
      const speed2 = b.vx * b.vx + b.vy * b.vy, deceleration = (b.friction * carrying + (b.team === -1 ? AIR_DRAG * speed2 : 0)) * dt;
      if (speed2 <= deceleration * deceleration) {
        b.vx = b.vy = 0;
      } else {
        const speed = Math.sqrt(speed2);
        const factor = Math.max(0, speed - deceleration) / speed;
        b.vx *= factor; b.vy *= factor;
      }
    }
    if (ball) {
      const speed = Math.hypot(ball.vx, ball.vy), pace = ball.pace || 0;
      ball.pace = Math.max(speed, pace - (ball.friction + AIR_DRAG * pace * pace) * dt);
      const share = ball.pace / MAX_SPEED;
      if (ball.onFire) {
        if (share <= HEAT.sustain) { ball.onFire = false; ball.fireTicks = 0; }
      } else {
        if (share > HEAT.fire) ball.fireTicks = Math.min(FIRE_TICKS, (ball.fireTicks || 0) + 1);
        else if (share <= HEAT.sustain) ball.fireTicks = 0;
        if (ball.fireTicks >= FIRE_TICKS && speed > HEAT.fire * MAX_SPEED) ball.onFire = true;
      }
    }
    // Contact radii never grow during a step (Colossus only shrinks back), so radii taken once
    // stay a safe bound for the broad phase.
    const count = bodies.length, hit = spareRadii?.length >= count ? spareRadii : new Float64Array(count);
    spareRadii = null;
    for (let i = 0; i < count; i++) hit[i] = ballHitRadius(bodies[i]);
    for (let pass = 0; pass < 3; pass++) {
      const resolvedBefore = resolved;
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        // Bodies further apart than both contact radii cannot touch; collide would return untouched.
        const a = bodies[i], c = bodies[j], reach = hit[i] + hit[j], dx = a.x - c.x, dy = a.y - c.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        collide(a, c, onCollide, bodies, onShockwave, guardedOnSuper);
      }
      for (const b of bodies) {
        if (b.team !== -1) {
          walls(b, onWall);
        }
      }
      if (ball) {
        if (resolved !== resolvedBefore) host = holder(bodies);
        if (host) {
          const off = ball.stickOffset || { x: host.radius + ball.radius, y: 0 };
          const ex = host.x + off.x, ey = host.y + off.y;
          ball.x = ex; ball.y = ey;
          ball.vx = host.vx; ball.vy = host.vy; ball.omega = host.omega;
          walls(ball, onWall);
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
          }
        } else {
          walls(ball, onWall);
        }
      }
      // Nothing touched: the field is unchanged, so further passes would find nothing either.
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
  function launch(bodies, plans) {
    for (const b of bodies) b.spinStrike = 0;
    bodies.forEach((b, i) => {
      if (b.team < 0) return;
      // A daze lasts until the ubu's next turn starts, whether or not it launches.
      if (b.stunned) {
        b.vx = 0; b.vy = 0; b.omega = 0;
        b.stunned = false; b.daze = 0;
        return;
      }
      if (b.superActive === 'colossus' && !b.colossusApplied) {
        b.colossusApplied = true;
        b.radius *= SUPER.colossusRadius;
        b.mass *= SUPER.colossusMass;
      }
      if (b.guarding) {
        b.vx *= GUARD_BRAKE; b.vy *= GUARD_BRAKE; b.omega *= GUARD_BRAKE; b.daze = 0;
        return;
      }
      // A launch steers toward the arrow's velocity using at most one full launch of change (more
      // for small ubus, which re-steer more easily), so a moving ubu can turn or brake but its own
      // launches never exceed full-launch speed. From rest this is the plain launch. No power leaves
      // the ubu coasting.
      const plan = plans[i] || { angle: 0, power: 0 };
      const full = launchSpeed(b), power = Math.max(0, Math.min(1, plan.power));
      b.daze = 0;
      if (power > 0) {
        const dx = Math.cos(plan.angle) * full * power - b.vx, dy = Math.sin(plan.angle) * full * power - b.vy;
        const scale = Math.min(1, full * (b.sizeMult || 1) ** SIZE.agility / (Math.hypot(dx, dy) || 1));
        b.vx += dx * scale; b.vy += dy * scale;
      }
      b.omega = Math.max(-b.maxSpin, Math.min(b.maxSpin, b.omega + Math.max(-1, Math.min(1, plan.spin || 0)) * b.maxSpin));
      if (plan.power > 0 && b.omega) b.spinStrike = STRIKE_GAIN;
    });
    // A spinning launch arms a spin strike: if the ball is the first thing the ubu touches, the
    // ball gains the ubu's remaining spin times its gain, counter-rotating, rising to point-blank within 2 ball diameters.
    const ball = bodies.find(b => b.team === -1);
    if (ball) {
      for (const b of bodies) {
        if (!b.spinStrike) continue;
        const gap = Math.max(0, Math.hypot(b.x - ball.x, b.y - ball.y) - ballHitRadius(b) - ball.radius);
        const proximity = Math.max(0, 1 - gap / (4 * ball.radius));
        b.spinStrike += (CLOSE_SPIN_GAIN - STRIKE_GAIN) * proximity * proximity * (3 - 2 * proximity);
      }
      ball.openingShot = bodies.some(b => b.spinStrike);
    }
  }
  // The ubu holding the ball with Sticky, or null. Held is a flag on the ubu, not a reference on the
  // ball, so the field survives JSON (online state and its storage).
  function holder(bodies) {
    for (const b of bodies) if (b.holding) return b;
    return null;
  }
  function settled(bodies) { return bodies.every(b => b.vx * b.vx + b.vy * b.vy < 4 && Math.abs(b.omega) < .05); }
  // Ends turn effects; keepMotion leaves velocities for a Pulse turn that ends mid-motion.
  function stop(bodies, keepMotion = false) {
    for (const b of bodies) {
      b.spinStrike = 0;
      b.openingShot = false;
      b.spinStruck = false;
      if (b.guardBase) Object.assign(b, b.guardBase);
      b.guardBase = null; b.guarding = false;
      if (!keepMotion) b.vx = b.vy = b.omega = 0;
      // In Pulse, a running super carries into the next turn until its time runs out.
      if (!keepMotion) endSuper(b, bodies);
    }
    const ball = bodies.find(b => b.team === -1);
    if (ball) {
      delete ball.pinX; delete ball.pinY;
      if (!keepMotion) {
        ball.stickOffset = null;
        ball.fireTicks = 0; ball.onFire = false; ball.pace = 0;
        ball.strikerPower = 1; ball.strikerTeam = -1;
      }
    }
  }
  // Steps the field after a goal: the ball remains pinned in the net with zero velocity,
  // while skaters continue on their momentum until settled.
  function stepPostGoal(bodies, dt = DT, onCollide = null, onWall = null, onShockwave = null, onSuper = null) {
    const ball = bodies.find(b => b.team === -1);
    if (ball) {
      ball.pinX ??= ball.x; ball.pinY ??= ball.y;
      ball.vx = 0; ball.vy = 0; ball.omega = 0;
    }
    step(bodies, dt, onCollide, onWall, onShockwave, onSuper);
    if (ball) {
      ball.x = ball.pinX; ball.y = ball.pinY;
      ball.vx = 0; ball.vy = 0; ball.omega = 0;
    }
  }
  // Follows the ball ahead on a copy of the field (with `removed` taken off it) until it touches an
  // ubu, or the boards unless `boards` allows them (posts and net always count as clear), stops or
  // `ticks` run out. Returns the goal it enters cleanly (as step reports it) or null, and how far it
  // travelled untouched.
  function ballRun(bodies, { removed = null, boards = false, ticks = 960 } = {}) {
    const sim = bodies.filter(b => b !== removed).map(b => ({ ...b, holding: false }));
    const ball = sim.find(b => b.team === -1);
    let clean = Boolean(ball), distance = 0;
    for (let t = 0; t < ticks && clean; t++) {
      const x = ball.x, y = ball.y;
      const goal = step(sim, DT, (a, b) => { if (a === ball || b === ball) clean = false; },
        (b, velocity, type) => { if (b === ball && type === 'wall' && !boards) clean = false; });
      if (clean) distance += Math.hypot(ball.x - x, ball.y - y);
      if (goal !== null) return { goal: clean ? goal : null, distance };
      if (!ball.vx && !ball.vy) break;
    }
    return { goal: null, distance };
  }
  // The goal the ball would enter with one body taken off the field, touching no ubu and no boards.
  function wouldScore(bodies, removed, ticks = 960) { return ballRun(bodies, { removed, ticks }).goal; }
  function segmentBlocked(ax, ay, bx, by, obstacles, clearance = 38) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    if (len2 < 1) return null;
    let best = null, bestT = 2;
    for (const ob of obstacles) {
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
  function cpuPlans(bodies, random = Math.random, scores = [0, 0]) {
    const ball = bodies[6], humans = bodies.slice(0, 3), players = bodies.slice(3, 6);
    const homeScore = scores?.[0] ?? 0, cpuScore = scores?.[1] ?? 0;
    const deficit = Math.max(0, homeScore - cpuScore);
    const matchPt = (homeScore >= 4 && cpuScore >= 4) ? 1 : (homeScore >= 4 || cpuScore >= 4) ? 0.85 : 0;
    const pressure = Math.min(1, Math.max(deficit === 1 ? 0.45 : deficit === 2 ? 0.75 : deficit >= 3 ? 1 : 0, matchPt));

    const traits = players.map(b => {
      const p = b.personality || {};
      const agg = Math.max(0, Math.min(1, (p.aggression ?? 31.5) / 63));
      const cre = Math.max(0, Math.min(1, (p.creativity ?? 31.5) / 63));
      const tmw = Math.max(0, Math.min(1, (p.teamwork ?? 31.5) / 63));
      const clu = Math.max(0, Math.min(1, (p.clutch ?? 31.5) / 63));
      const surge = pressure * (clu - 0.5) * 2;
      return { agg, cre, tmw, clu, surge };
    });

    const strikeScore = i => {
      const b = players[i], { agg, surge } = traits[i];
      const d = Math.hypot(b.x - ball.x, b.y - ball.y);
      return -d + (b.x >= ball.x - 10 ? 75 : -45) + (agg - 0.5) * 110 + Math.max(0, surge) * 35 - (b.stunned ? 10000 : 0);
    };
    const strikerIdx = [0, 1, 2].reduce((best, i) => strikeScore(i) > strikeScore(best) ? i : best, 0);
    const rem = [0, 1, 2].filter(i => i !== strikerIdx);

    const anchorScore = i => {
      const b = players[i], { agg, surge } = traits[i];
      const sKey = b.equippedSuper?.key || b.superKey;
      const dGoal = Math.hypot(b.x - 850, b.y - 300);
      return (1 - agg) * 170 - dGoal * 0.45 - surge * 40 + (sKey === 'stalwart' ? 60 : 0) + (b.slot === 0 ? 8 : 0);
    };
    const anchorIdx = anchorScore(rem[0]) >= anchorScore(rem[1]) ? rem[0] : rem[1];
    const wingIdx = rem.find(i => i !== anchorIdx);
    const wing = players[wingIdx], wTrait = traits[wingIdx];
    const wingOpenY = ball.y < 300 ? 390 : 210;
    const wingOpenX = Math.max(200, Math.min(760, ball.x - 90 + (1 - wTrait.agg) * 180 - Math.max(0, wTrait.surge) * 70));

    return players.map((b, idx) => {
      if (b.stunned) return { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
      const { agg, cre, tmw, surge } = traits[idx];
      const sKey = b.equippedSuper?.key || b.superKey;
      const canSuper = (b.meter ?? 0) >= 100 && !b.stunned;
      const reachR = Math.max(b.radius, b.reach || b.radius, 18);
      const contactDist = reachR + ball.radius - 2;
      const dBall = Math.hypot(b.x - ball.x, b.y - ball.y);

      let tx = b.x, ty = b.y, spin = 0, superArm = false, extraDrive = 0;

      if (idx === strikerIdx) {
        if (b.x < ball.x - 14) {
          if (canSuper && sKey === 'magnet' && dBall < 180) {
            superArm = true;
            tx = 60; ty = 300 + (b.y >= ball.y ? 45 : -45);
            extraDrive = 160;
          } else {
            const sideY = b.y < ball.y ? -48 : 48;
            tx = Math.min(890, ball.x + 68);
            ty = Math.max(95, Math.min(505, ball.y + sideY * (1 - Math.abs(b.x - ball.x) / 400)));
            if (cre > 0.3) spin = (sideY < 0 ? 0.55 : -0.55) * cre;
          }
        } else {
          const humanGoalie = humans.reduce((best, h) =>
            Math.hypot(h.x - 120, h.y - 300) < Math.hypot(best.x - 120, best.y - 300) ? h : best, humans[0]);
          const cornerY = humanGoalie && humanGoalie.y >= 300 ? 252 : 348;
          const baseGoalY = 300 + Math.max(-34, Math.min(34, (ball.y - 300) * 0.22));
          const goalY = baseGoalY + (cornerY - baseGoalY) * Math.max(0, Math.min(1, surge * 0.75 + cre * 0.25));
          const goalX = 60;

          const shotBlock = segmentBlocked(ball.x, ball.y, goalX, goalY, humans, 24);
          const approachBlock = segmentBlocked(b.x, b.y, ball.x, ball.y, humans, 20);

          let aimBallX = goalX, aimBallY = goalY;
          if (tmw >= 0.58 && surge < 0.45 && (shotBlock || ball.x > 640) && wing.x < ball.x + 40) {
            aimBallX = Math.max(150, wing.x - 45);
            aimBallY = Math.max(110, Math.min(490, wing.y + (wing.y < 300 ? 25 : -25)));
          } else if (cre >= 0.55 && shotBlock && !(canSuper && (sKey === 'cannonball' || sKey === 'shockwave'))) {
            if (cre >= 0.72 && Math.abs(ball.y - 300) > 45) {
              aimBallX = (ball.x + goalX) * 0.5;
              aimBallY = ball.y < 300 ? 78 : 522;
            } else {
              spin = -shotBlock.side * Math.min(1, 0.45 + cre * 0.55);
            }
          }
          if (spin === 0 && cre > 0.35) {
            spin = Math.max(-1, Math.min(1, ((b.y - ball.y) / 180) * cre * 0.75));
          }

          const bdx = aimBallX - ball.x, bdy = aimBallY - ball.y, bd = Math.hypot(bdx, bdy) || 1;
          const jitterScale = Math.max(0.15, 1 - Math.max(0, -surge) * 0.75);
          const jitter = (random() - 0.5) * 10 * jitterScale;
          tx = ball.x - (bdx / bd) * contactDist;
          ty = ball.y - (bdy / bd) * contactDist + jitter;
          extraDrive = 220 + agg * 50 + surge * 75;

          if (canSuper) {
            if (sKey === 'cannonball' && dBall < 340) superArm = true;
            else if (sKey === 'sticky' && dBall < 300) superArm = true;
            else if (sKey === 'ghost' && (approachBlock || dBall < 280)) superArm = true;
            else if (sKey === 'magnet' && dBall < 230) superArm = true;
            else if (sKey === 'shockwave' && dBall < 260 && (shotBlock || approachBlock)) superArm = true;
            else if (sKey === 'knockout' && approachBlock && dBall < 280) superArm = true;
            else if (sKey === 'colossus' && dBall < 220 && (agg > 0.55 || surge > 0.3)) superArm = true;
          }
        }
      } else if (idx === anchorIdx) {
        const anchorX = Math.max(700, Math.min(875, 855 - agg * 65 - Math.max(0, surge) * 95 + Math.max(0, -surge) * 18));
        const ySpan = 55 + agg * 25;
        const anchorY = Math.max(300 - ySpan, Math.min(300 + ySpan, ball.y));

        if (ball.x > 740 && b.x >= ball.x - 8 && dBall < 170 && (agg > 0.25 || ball.x > 810)) {
          const clearY = ball.y < 300 ? 140 : 460;
          const bdx = 200 - ball.x, bdy = clearY - ball.y, bd = Math.hypot(bdx, bdy) || 1;
          tx = ball.x - (bdx / bd) * contactDist;
          ty = ball.y - (bdy / bd) * contactDist;
          extraDrive = 190;
        } else {
          tx = anchorX; ty = anchorY;
        }

        if (canSuper) {
          const inCrease = b.x >= 770 && b.y >= 220 && b.y <= 380;
          const threat = ball.x > 480 || pressure >= 0.45;
          if (sKey === 'stalwart' && inCrease && threat && Math.hypot(tx - b.x, ty - b.y) < 45) superArm = true;
          else if (sKey === 'colossus' && (inCrease || ball.x > 580)) superArm = true;
          else if ((sKey === 'shockwave' || sKey === 'sticky') && ball.x > 680 && dBall < 220) superArm = true;
          else if (sKey === 'magnet' && ball.x > 650 && dBall < 190) superArm = true;
        }
      } else {
        const nearestThreat = humans.reduce((best, h) =>
          Math.hypot(h.x - ball.x, h.y - ball.y) < Math.hypot(best.x - ball.x, best.y - ball.y) ? h : best, humans[0]);
        const dThreat = nearestThreat ? Math.hypot(b.x - nearestThreat.x, b.y - nearestThreat.y) : 999;

        if (nearestThreat && (agg > tmw + 0.18 || (canSuper && (sKey === 'knockout' || sKey === 'shockwave'))) && dThreat < 280 && nearestThreat.x > 280) {
          tx = nearestThreat.x; ty = nearestThreat.y;
          extraDrive = 150 + agg * 70;
          if (canSuper && (sKey === 'knockout' || sKey === 'shockwave' || sKey === 'colossus')) superArm = true;
        } else {
          tx = wingOpenX; ty = wingOpenY;
          if (cre > 0.5) spin = (ty < 300 ? 0.35 : -0.35) * cre;
          if (canSuper) {
            if (sKey === 'magnet' && dBall < 190) superArm = true;
            else if (sKey === 'ghost' && segmentBlocked(b.x, b.y, tx, ty, humans, 18)) superArm = true;
            else if (sKey === 'colossus' && (dBall < 220 || surge > 0.4)) superArm = true;
          }
        }
      }

      const dx = tx - b.x, dy = ty - b.y, distance = Math.hypot(dx, dy);
      const superLaunchScale = (superArm && sKey === 'colossus' && !b.colossusApplied) ? SUPER.colossusLaunch
        : (superArm && sKey === 'stalwart' && b.superActive !== 'stalwart' ? SUPER.stalwartLaunch : 1);
      const maxV = launchSpeed(b) * superLaunchScale;
      let angle = Math.atan2(dy, dx);
      const power = distance < 10 ? 0 : Math.min(1, Math.sqrt(2 * b.friction * Math.max(0, distance + extraDrive)) / maxV);

      if (Math.abs(spin) > 0.01 && power > 0.05) {
        const omega0 = spin * (b.maxSpin || 10);
        const curveF = b.curveFactor ?? SKATER_CURVE;
        const v0 = Math.max(60, power * maxV);
        const estT = Math.min(1.2, distance / (v0 * 0.72));
        const avgOmega = Math.sign(omega0) * Math.max(0, Math.abs(omega0) - SPIN_DECAY / 2 * estT);
        angle -= avgOmega * curveF * estT * 0.5;
      }

      // A baseline ubu with nowhere to go brakes in place.
      if (!power) return { angle: 0, power: 0, spin: 0, superArm: Boolean(superArm), guard: true };
      return { angle, power, spin: Math.max(-1, Math.min(1, spin)), superArm: Boolean(superArm), guard: false };
    });
  }
  // Shared turn preparation for gameplay and prediction. Supers activate before launch.
  function startTurn(bodies, plans, onSuper = null) {
    bodies.forEach((b, i) => {
      if (b.team < 0) return;
      if (b.guardBase) Object.assign(b, b.guardBase);
      b.guardBase = null;
      // A stunned (knocked-out) ubu is simply frozen: it cannot guard.
      b.guarding = Boolean(plans[i]?.guard) && !b.stunned;
      if (b.guarding) {
        b.guardBase = { reach: b.reach, friction: b.friction, strength: b.strength, stability: b.stability, bounciness: b.bounciness };
        b.reach = Math.max(b.radius, Math.min(37.5, (b.reach || b.radius) * 1.25));
        b.friction = Math.min(225, b.friction * 1.25);
        b.strength = Math.min(1.5, (b.strength || 1) * 1.25);
        b.stability = Math.min(1.5, (b.stability || 1) * 1.25);
        b.bounciness = Math.max(2 / 3, (b.bounciness || 1) * .75);
      }
      b.usedSuperThisTurn = Boolean(b.superActive) && !b.stunned;
      if (!b.stunned && (b.superArm || plans[i]?.superArm) && b.meter >= 100) {
        b.usedSuperThisTurn = true;
        b.meter = 0;
        b.superActive = b.equippedSuper.key;
        const bonusTicks = b.equippedSuper?.bonusTicks ?? b.superBonusTicks ?? 0;
        b.superTicks = SUPER.ticks + bonusTicks;
        b.superHoldTicks = SUPER.holdTicks + bonusTicks;
        b.superArm = false;
        b.superHit = false;
        b.superRefunded = false;
        if (['stalwart', 'colossus', 'ghost'].includes(b.superActive)) onSuper?.(b.superActive, 'launch', b);
      }
    });
    launch(bodies, plans);
  }
  const PREDICTION_TICKS = 480;
  function predictTurn(bodies, plans) {
    // Clone the whole graph so Sticky references point to cloned teammates.
    const sim = structuredClone(bodies);
    const held = { angle: 0, power: 0, spin: 0 };
    const predictedPlans = sim.map((b, i) => {
      if (b.team === 0) return plans[i] || held;
      if (b.team > 0) {
        b.superArm = false;
        b.superActive = null;
        if (b.colossusApplied) {
          b.radius = b.baseRadius; b.mass = b.baseMass; b.colossusApplied = false;
        }
      }
      return held;
    });
    startTurn(sim, predictedPlans);
    const paths = sim.map(b => [{ x: b.x, y: b.y, tick: 0 }]);
    // Each guarding ubu a burning ball first hits, by index: true if it holds (an Iron Save, or a
    // teammate's fireball it is not overpowered by), false if the fireball beats it.
    const impacts = [], lastImpact = new Map(), guards = new Map(), ball = sim.find(b => b.team === -1);
    // Where and when the ball catches fire, if it is not already burning.
    let goal = null, ticks = 0, ignition = null, burning = ballOnFire(ball);
    let goalTargets = null, goalTick = null;
    function recordImpact(b) {
      const index = sim.indexOf(b), last = lastImpact.get(index);
      if (last && (ticks - last.tick < 12 || Math.hypot(b.x - last.x, b.y - last.y) < 8)) return;
      const marker = { index, x: b.x, y: b.y, radius: b.radius, reach: b.team < 0 ? b.radius : Math.max(b.radius, b.reach || b.radius), tick: ticks };
      lastImpact.set(index, marker);
      impacts.push(marker);
    }
    for (let tick = 1; tick <= PREDICTION_TICKS; tick++) {
      ticks = tick;
      const onCollide = (a, b, speed, impulse, plow, iron) => {
        recordImpact(a); recordImpact(b);
        const ubu = a === ball ? b : b === ball ? a : null, index = sim.indexOf(ubu);
        // A hit the fireball neither wins nor quenches leaves its fire as it was before the hit.
        if (ubu?.guarding && !guards.has(index) && (plow || iron || ballOnFire(ball))) guards.set(index, !plow);
      };
      if (goal !== null) {
        stepPostGoal(sim, DT, onCollide, recordImpact);
      } else {
        const stepGoal = step(sim, DT, onCollide, recordImpact);
        if (stepGoal !== null) {
          goal = stepGoal;
          goalTick = tick;
          const ballIndex = sim.indexOf(ball);
          goalTargets = sim.map((b, i) => ({ x: b.x, y: b.y, index: i, team: b.team }));
          if (ball && ballIndex >= 0) paths[ballIndex].push({ x: ball.x, y: ball.y, tick });
        }
      }
      if (ball && !burning && ballOnFire(ball)) { burning = true; ignition = { x: ball.x, y: ball.y, tick, team: ball.strikerTeam }; }
      const done = (goal !== null ? settled(sim.slice(0, 6)) : settled(sim)) || tick === PREDICTION_TICKS;
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
  const api = { VERSION, rink, DT, MAX_SPEED, IMPULSE, SUPERS, DAZE, SIZE, SUPER, HEAT, FIRE_TICKS, ballOnFire, holder, dazeSlow, multiplier, launchSpeed, applyStats, spawn, kickoff, endSuper, superMastery, step, stepPostGoal, launch, settled, stop, ballRun, wouldScore, triggerShockwave, triggerIronShockwave, cpuPlans, startTurn, predictTurn };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallPhysics = api;
})(globalThis);
