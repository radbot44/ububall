'use strict';
(function (root) {
  const {
    GOAL_WORDS, callText, MATERIAL_STYLES, SUPER_AURA_THEMES, GOAL_CALL_SECONDS,
    createMaterialEmitters, createEffectsState, setMeterFill, mountSkaterSprites,
    impulseGeometry, createRinkPresenter
  } = typeof require === 'function' ? require('./ububall-presentation.js') : root.ububallPresentation;

  // Declarative Ububall Effects Catalog, ordered logically by match progression.
  //
  // HOW TO ADD FUTURE EFFECTS:
  // 1. Implement the visual rendering or audio dispatch once in `web/ububall-presentation.js`
  //    (and/or `shared/ubu-audio.js`) so live matches, replays, MP4 export, and `/effects` share it.
  // 2. New entries in `ububallPhysics.SUPERS`, `MATERIAL_STYLES`, or `GOAL_WORDS` automatically
  //    populate the workbench pickers.
  // 3. Add an item to the matching group in `EFFECT_GROUPS` below:
  //    {
  //      id: 'unique-id',
  //      title: 'Human Title',
  //      when: 'In-game condition that triggers this effect',
  //      visual: 'Visual & audio summary',
  //      soundLabel: 'Play sound',              // optional: adds a dedicated sound-only button
  //      playSound: (ctx, variant) => { ... },  // optional: isolated ubuAudio trigger
  //      variants: [{ id, label }, ...],        // optional: sub-variant selector pills on the card
  //      duration: 2.6,                         // optional: loop cycle duration in seconds
  //      run: (ctx, variant) => { ... }         // stages physics/state on the shared rink presenter
  //    }

  const GOAL_CALL_VARIANTS = [
    { id: 'GOAL', label: 'GOAL' },
    ...Object.keys(GOAL_WORDS).filter(k => k !== 'GOAL').map(label => ({ id: label, label })),
    { id: 'HOME WINS!', label: 'HOME WINS!' }
  ];

  const EFFECT_GROUPS = [
    {
      id: 'start',
      title: '1. Match Start',
      summary: 'Opening faceoff ring, starting Ubuquity super meters, and multi-voice arena jingle.',
      items: [
        {
          id: 'kickoff-start',
          title: 'Match Start Jingle & Kickoff Glow',
          when: 'New match begins or round resets to center ice (`newMatch` / `kickoff`).',
          visual: 'Expanding primary-color glow ring around the center faceoff circle (`kickoffGlow = 1`) and initial Ubuquity meter fill.',
          soundLabel: 'Play start jingle',
          duration: 2.8,
          playSound: ctx => ctx.audio()?.playGameStart({ volume: 0.95 }),
          run: ctx => {
            ctx.resetStage({ phase: 'plan', mode: 'standard', glow: 1 });
            ctx.bodies.slice(0, 6).forEach((b, i) => {
              const rating = ctx.entries[i]?.model?.rating ?? (340 + i * 130);
              b.meter = Math.min(100, (rating / 1020) * 100);
            });
            ctx.syncMeters(true);
            ctx.banner('Faceoff!', 1200, 'launch');
            ctx.audio()?.playGameStart({ volume: 0.95 });
          }
        }
      ]
    },
    {
      id: 'planning',
      title: '2. Planning & Prediction',
      summary: 'Aim arrows, spin arcs, trajectory previews, fireball ignition markers, and goal beacons.',
      items: [
        {
          id: 'plan-aim',
          title: 'Aim Impulse Arrow, Tapered Spin Arcs & Guard Fade',
          when: 'Selecting and aiming skaters during the `plan` phase (`drawImpulse`, `drawSpin`).',
          visual: 'Selected skater highlight ring, Impulse/Size-scaled aim arrow, tapered directional spin blades pointing CW/CCW, and 25%-alpha guarded arrow with blue shield.',
          duration: 3.0,
          run: ctx => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.setSelected(0);
            ctx.plans[0] = { angle: -0.18, power: 0.95, spin: 0.85, guard: false };
            ctx.plans[1] = { angle: 0.42, power: 0.72, spin: 0, guard: true };
            ctx.plans[2] = { angle: -0.52, power: 0.65, spin: -0.7, guard: false };
            ctx.bodies[0].omega = 14;
            ctx.bodies[2].omega = -10;
            ctx.presenter.dirtyPrediction();
          }
        },
        {
          id: 'plan-aim-coil',
          title: 'Loaded Shot Coil, Rubber Stretch & Guard Plant',
          when: 'Dragging outward to load a shot (`aimCoilPose`, `playAimScrape`) or tapping to plant Guard (`triggerGuardToggle`, `playGuardToggle`). Try dragging or tapping any home ubu directly on the rink!',
          visual: 'The face coils back up to 4.6 px inside its fixed hitbox, with a white arc along the back rim. A low rubber stretch tightens in pitch as shot power rises. Fine tweaks sound softer, and holding still goes quiet until the next movement.',
          soundLabel: 'Play stretch / plant',
          variants: [
            { id: 'load-scrape', label: 'Brisk Pull -> Hold -> Fine Tweak' },
            { id: 'guard-toggle', label: 'Guard Plant & Un-Weight Toggle' },
            { id: 'loaded-trio', label: 'Loaded Trio vs. Fixed Hitbox Rings' }
          ],
          duration: 2.9,
          playSound: (ctx, variant = 'load-scrape') => {
            if (variant === 'guard-toggle') {
              ctx.audio()?.playGuardToggle?.(true, { x: 310, y: 300 });
            } else {
              ctx.audio()?.playAimScrape?.({ speed: 680, power: 0.88, x: 310, y: 300 });
            }
          },
          run: (ctx, variant = 'load-scrape') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.place(0, 290, 300);
            ctx.place(1, 290, 170);
            ctx.place(2, 290, 430);
            ctx.place(6, 470, 300);
            ctx.setSelected(0);
            if (variant === 'loaded-trio') {
              ctx.plans[0] = { angle: 0, power: 1.0, spin: 0, guard: false };
              ctx.plans[1] = { angle: 0.24, power: 0.48, spin: 0, guard: false };
              ctx.plans[2] = { angle: -0.22, power: 0.85, spin: 0, guard: true };
              ctx.presenter.dirtyPrediction();
              return;
            }
            if (variant === 'guard-toggle') {
              ctx.plans[0] = { angle: 0.06, power: 0.92, spin: 0, guard: false };
              ctx.presenter.dirtyPrediction();
              let stage = 0;
              ctx.setPlanDriver(t => {
                if (stage === 0 && t >= 0.45) {
                  stage = 1;
                  ctx.plans[0] = { ...ctx.plans[0], guard: true };
                  ctx.presenter.triggerGuardToggle?.(0, true);
                  ctx.presenter.dirtyPrediction();
                } else if (stage === 1 && t >= 1.35) {
                  stage = 2;
                  ctx.plans[0] = { ...ctx.plans[0], guard: false };
                  ctx.presenter.triggerGuardToggle?.(0, false);
                  ctx.presenter.dirtyPrediction();
                } else if (stage === 2 && t >= 2.15) {
                  stage = 3;
                  ctx.plans[0] = { ...ctx.plans[0], guard: true };
                  ctx.presenter.triggerGuardToggle?.(0, true);
                  ctx.presenter.dirtyPrediction();
                }
              });
              return;
            }
            // Brisk pull, silent hold, then a small angle correction at full tension.
            ctx.plans[0] = { angle: 0.16, power: 0, spin: 0, guard: false };
            ctx.presenter.dirtyPrediction();
            let lastP = 0, lastA = 0.16;
            ctx.setPlanDriver((t, dt) => {
              let p = lastP, a = lastA;
              if (t >= 0.12 && t < 0.48) {
                const u = (t - 0.12) / 0.36;
                const ease = 1 - (1 - u) ** 2.4;
                p = 0.96 * ease;
                a = 0.16 - 0.18 * ease;
              } else if (t >= 0.48 && t < 1.05) {
                p = 0.96;
                a = -0.02;
              } else if (t >= 1.05 && t < 1.45) {
                const u = (t - 1.05) / 0.40;
                p = 0.96;
                a = -0.02 + 0.065 * Math.sin(u * Math.PI * 0.5);
              } else if (t >= 1.45) {
                p = 0.96;
                a = 0.045;
              }
              const dPower = Math.abs(p - lastP), dAngle = Math.abs(a - lastA);
              const tipSpeed = dt > 1e-4 ? Math.hypot(dPower * 165, dAngle * 180) / dt : 0;
              ctx.audio()?.playAimScrape?.({ id: 0, speed: tipSpeed, power: p, x: 290, y: 300 });
              if (dPower > 1e-4 || dAngle > 1e-4) {
                ctx.plans[0] = { angle: a, power: p, spin: 0, guard: false };
                ctx.presenter.dirtyPrediction();
              }
              lastP = p;
              lastA = a;
            });
          }
        },
        {
          id: 'plan-spin-crown',
          title: 'Spin Crown Winding & Wound Inner-Face Tilt',
          when: 'Winding Spin via the Spin knob, slider, `Q`/`E`, or mouse wheel (`playSpinTick`, `aimCoilPose` `twist` & wound rim arc). Try scrolling your mouse wheel over the rink!',
          visual: 'Inner character face tilts up to 16 deg in the wound CW/CCW direction with a glowing directional inner-rim crescent. The crown makes a short tick at each step, with a firmer, lower tick at zero.',
          soundLabel: 'Play crown / detent',
          variants: [
            { id: 'wind-zero-wind', label: 'Wind CW -> Zero Detent -> Wind CCW' },
            { id: 'wound-trio', label: 'CW vs. Zero vs. CCW Wound Trio' },
            { id: 'center-detent', label: 'Zero-Detent Notch Click' }
          ],
          duration: 3.0,
          playSound: (ctx, variant = 'wind-zero-wind') => {
            if (variant === 'center-detent') {
              ctx.audio()?.playSpinTick?.({ spin: 0, center: true, x: 310, y: 300 });
            } else {
              [0.2, 0.5, 0.85].forEach((sp, idx) => {
                setTimeout(() => ctx.audio()?.playSpinTick?.({ spin: sp, center: false, x: 310, y: 300 }), idx * 75);
              });
              setTimeout(() => ctx.audio()?.playSpinTick?.({ spin: 0, center: true, x: 310, y: 300 }), 280);
            }
          },
          run: (ctx, variant = 'wind-zero-wind') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.place(0, 290, 300);
            ctx.place(1, 290, 165);
            ctx.place(2, 290, 435);
            ctx.place(6, 510, 300);
            ctx.setSelected(0);
            if (variant === 'wound-trio') {
              ctx.plans[1] = { angle: 0.08, power: 0.72, spin: 1.0, guard: false };
              ctx.plans[0] = { angle: 0, power: 0.72, spin: 0, guard: false };
              ctx.plans[2] = { angle: -0.08, power: 0.72, spin: -1.0, guard: false };
              ctx.presenter.dirtyPrediction();
              return;
            }
            if (variant === 'center-detent') {
              ctx.plans[0] = { angle: 0, power: 0.68, spin: 0.45, guard: false };
              ctx.presenter.dirtyPrediction();
              let prevS = 0.45;
              ctx.setPlanDriver(t => {
                const s = t < 0.2 ? 0.45 : t < 1.1 ? 0.45 - ((t - 0.2) / 0.9) * 0.90 : -0.45 + Math.min(1, (t - 1.1) / 0.9) * 0.45;
                if ((Math.abs(prevS) > 0.005 && Math.abs(s) <= 0.005) || (prevS * s < 0)) {
                  ctx.audio()?.playSpinTick?.({ spin: 0, center: true, x: 290, y: 300 });
                } else if (Math.floor(Math.abs(s) / 0.12) !== Math.floor(Math.abs(prevS) / 0.12)) {
                  ctx.audio()?.playSpinTick?.({ spin: s, center: false, x: 290, y: 300 });
                }
                if (Math.abs(s - prevS) > 1e-4) {
                  ctx.plans[0] = { angle: 0, power: 0.68, spin: s, guard: false };
                  ctx.presenter.dirtyPrediction();
                  prevS = s;
                }
              });
              return;
            }
            ctx.plans[0] = { angle: 0, power: 0.76, spin: 0, guard: false };
            ctx.presenter.dirtyPrediction();
            let lastS = 0;
            ctx.setPlanDriver(t => {
              let s = 0;
              if (t >= 0.10 && t < 0.85) s = Math.min(1, (t - 0.10) / 0.75);
              else if (t >= 0.85 && t < 1.15) s = 1;
              else if (t >= 1.15 && t < 2.25) s = 1 - ((t - 1.15) / 1.10) * 2;
              else if (t >= 2.25) s = -1;
              const crossedZero = (Math.abs(lastS) > 0.005 && Math.abs(s) <= 0.005) || (lastS * s < 0);
              if (crossedZero) {
                ctx.audio()?.playSpinTick?.({ spin: 0, center: true, x: 290, y: 300 });
              } else if (Math.floor(Math.abs(s) / 0.09) !== Math.floor(Math.abs(lastS) / 0.09)) {
                ctx.audio()?.playSpinTick?.({ spin: s, center: false, x: 290, y: 300 });
              }
              if (Math.abs(s - lastS) > 1e-4) {
                ctx.plans[0] = { angle: 0, power: 0.76, spin: s, guard: false };
                ctx.presenter.dirtyPrediction();
                lastS = s;
              }
            });
          }
        },
        {
          id: 'plan-prediction',
          title: 'Trajectory, Wall Stamps, Stop Marks & Pulse Ticks',
          when: 'Planning moves with board bounces, stops, or Pulse 1-second turns (`paintPrediction`).',
          visual: 'Round-capped 4-tick skater/ball dashes whose length tracks speed, smoothly fading toward the horizon, translucent wall-impact stamps, settled `x` stop marks, and Pulse 1s turn-end ticks.',
          variants: [
            { id: 'pulse', label: 'Pulse 1s Ticks + Ice Tint' },
            { id: 'standard', label: 'Standard Full Horizon' }
          ],
          duration: 3.0,
          run: (ctx, variant = 'pulse') => {
            ctx.resetStage({ phase: 'plan', mode: variant === 'pulse' ? 'pulse' : 'standard' });
            if (variant === 'pulse') ctx.bodies[3].vx = -40; // Unsettled field triggers Pulse plan ice tint
            ctx.place(0, 330, 155);
            ctx.place(1, 250, 390);
            ctx.place(2, 180, 300);
            ctx.place(6, 470, 125);
            ctx.plans[0] = { angle: -0.52, power: 0.95, spin: 0.65, guard: false };
            ctx.plans[1] = { angle: 0.35, power: 0.48, spin: 0, guard: false };
            ctx.plans[2] = { angle: 0, power: 0.32, spin: 0, guard: false };
            ctx.presenter.dirtyPrediction();
          }
        },
        {
          id: 'plan-goal-glow',
          title: 'Predicted Fireball Ignition & Pulsing Goal Beacon',
          when: 'Planned shot reaches 60 heat ticks (>840 px/s) and enters a goal (`IGNITION_FLAME`, `drawPredictedGoalGlow`).',
          visual: 'Team-colored flame icon at exact ignition point, reticle target in goal mouth, and urgency-pulsing net glow (1.2-5.5 Hz).',
          duration: 3.2,
          run: ctx => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.place(0, 395, 300);
            ctx.boostStats(0, { power: 255, impulse: 255 });
            ctx.equipSuper(0, 3); // Cannonball ensures instant predicted ignition + scorching goal
            ctx.bodies[0].meter = 100;
            ctx.bodies[0].superArm = true;
            ctx.place(6, 455, 300);
            ctx.place(3, 760, 150);
            ctx.place(4, 760, 450);
            ctx.place(5, 620, 470);
            ctx.plans[0] = { angle: 0, power: 1, spin: 0.12, guard: false, superArm: true };
            ctx.syncMeters();
            ctx.presenter.dirtyPrediction();
          }
        },
        {
          id: 'plan-iron-preview',
          title: 'Armed Colossus Ring & Predicted Iron Guard Shield',
          when: 'Colossus is armed in `plan` or a Guarding skater is predicted to hold against a fireball.',
          visual: 'Dashed golden uniform 1.5x max Colossus preview circle (`#ffe043cc`) alongside a Guard shield turning metallic iron (`#c3ccd6`).',
          duration: 3.0,
          run: ctx => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            // Skater 0 guards in front of teammate 2's armed Cannonball -> predicted friendly Iron Trap!
            ctx.boostStats(0, { stability: 255, mass: 255 });
            ctx.boostStats(2, { power: 40 });
            ctx.place(0, 470, 300);
            ctx.plans[0] = { angle: 0, power: 0.5, spin: 0, guard: true };
            ctx.place(2, 290, 300);
            ctx.equipSuper(2, 3);
            ctx.bodies[2].meter = 100;
            ctx.bodies[2].superArm = true;
            ctx.place(6, 350, 300);
            ctx.plans[2] = { angle: 0, power: 1, spin: 0, guard: false, superArm: true };
            // Skater 1 arms Colossus -> dashed uniform 1.5x max size ring preview
            ctx.place(1, 330, 155);
            ctx.equipSuper(1, 5);
            ctx.bodies[1].meter = 100;
            ctx.bodies[1].superArm = true;
            ctx.plans[1] = { angle: 0.25, power: 0.8, spin: 0, guard: false, superArm: true };
            ctx.syncMeters();
            ctx.presenter.dirtyPrediction();
          }
        }
      ]
    },
    {
      id: 'movement',
      title: '3. Movement, Spin & Materials',
      summary: 'Launch skate push-offs, moving ubu wobbles, puck glides, tapered spin arcs, ice braking, front wind cones, Pulse cuts, and 32 DNA materials.',
      items: [
        {
          id: 'launch-skate-push',
          title: 'Launch Skate Push-Off: Sprinter Snap vs. Bruiser Dig',
          when: 'Releasing **Launch team** from a loaded coil (`startTurn` `kind === "push"`, `launchNicks`, `ubuRecoils`, `playLaunchPush`).',
          visual: 'Coiled ubus snap forward out of their rings leaving twin V-shaped skate-blade heel nicks and backward shaved-ice puffs—crisp & high for featherweight sprinters, deep & crunchy for heavy bruisers, and silent at 0% power.',
          soundLabel: 'Play skate push',
          variants: [
            { id: 'trio-stereo', label: '3-Skater Stereo Spring Uncoil' },
            { id: 'light-sprinter', label: 'Featherweight Sprinter (Crisp Push)' },
            { id: 'heavy-bruiser', label: 'Heavyweight Bruiser (Deep Ice Dig)' },
            { id: 'idle-silent', label: '0% Power Control (Dead Silent)' }
          ],
          duration: 2.3,
          playSound: (ctx, variant = 'trio-stereo') => {
            if (variant === 'idle-silent') return;
            if (variant === 'light-sprinter') {
              ctx.audio()?.playLaunchPush?.({ power: 0.95, mass: 2.3, radius: 18, x: 240, y: 300 });
            } else if (variant === 'heavy-bruiser') {
              ctx.audio()?.playLaunchPush?.({ power: 0.95, mass: 4.8, radius: 37, x: 240, y: 300 });
            } else {
              ctx.audio()?.playLaunchPush?.({ power: 0.92, mass: 2.4, radius: 19, x: 200, y: 175 });
              setTimeout(() => ctx.audio()?.playLaunchPush?.({ power: 0.95, mass: 3.1, radius: 25, x: 340, y: 300 }), 45);
              setTimeout(() => ctx.audio()?.playLaunchPush?.({ power: 0.95, mass: 4.7, radius: 36, x: 480, y: 425 }), 90);
            }
          },
          run: (ctx, variant = 'trio-stereo') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.place(6, 780, 300);
            ctx.place(3, 850, 150);
            ctx.place(4, 850, 450);
            ctx.place(5, 880, 300);
            if (variant === 'light-sprinter') {
              ctx.boostStats(0, { size: 0, mass: 0, impulse: 240 });
              ctx.place(0, 240, 300);
              ctx.place(1, 160, 120);
              ctx.place(2, 160, 480);
              ctx.plans[0] = { angle: 0, power: 0.96, spin: 0, guard: false };
            } else if (variant === 'heavy-bruiser') {
              ctx.boostStats(0, { size: 255, mass: 255, impulse: 210 });
              ctx.place(0, 240, 300);
              ctx.place(1, 160, 120);
              ctx.place(2, 160, 480);
              ctx.plans[0] = { angle: 0, power: 0.96, spin: 0, guard: false };
            } else if (variant === 'idle-silent') {
              ctx.place(0, 260, 300);
              ctx.place(1, 260, 175);
              ctx.place(2, 260, 425);
              // All 0% power: stays completely uncoiled and silent on launch
            } else {
              // Left-to-right stereo showcase: featherweight top-left, balanced center, heavyweight bottom-mid
              ctx.boostStats(0, { size: 5, mass: 5, impulse: 235 });
              ctx.boostStats(1, { size: 127, mass: 127, impulse: 200 });
              ctx.boostStats(2, { size: 250, mass: 255, impulse: 210 });
              ctx.place(0, 200, 175);
              ctx.place(1, 300, 300);
              ctx.place(2, 410, 425);
              ctx.plans[0] = { angle: 0.06, power: 0.95, spin: 0, guard: false };
              ctx.plans[1] = { angle: 0, power: 0.92, spin: 0, guard: false };
              ctx.plans[2] = { angle: -0.06, power: 0.95, spin: 0, guard: false };
            }
            ctx.presenter.dirtyPrediction();
            let fired = false;
            ctx.setPlanDriver(t => {
              if (!fired && t >= 0.42) {
                fired = true;
                ctx.setPlanDriver(null);
                ctx.launchPlans(ctx.plans);
              }
            });
          }
        },
        {
          id: 'motion-trails',
          title: 'Skater & Ball Motion Trails',
          when: 'Skaters or ball move faster than 25 px/s (`recordTrails`, `drawTrails`).',
          visual: 'Feathered tapered team-colored and animated heat-shimmering fireball ribbons (0.24s life) with semicircular caps that split cleanly at sharp bounce corners.',
          duration: 2.6,
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(0, 200, 180, { vx: 620, vy: 210, omega: 12 });
            ctx.place(1, 220, 430, { vx: 580, vy: -240, omega: -11 });
            ctx.place(3, 800, 200, { vx: -590, vy: 220, omega: -10 });
            ctx.place(4, 780, 420, { vx: -560, vy: -200, omega: 10 });
            ctx.place(6, 500, 300, { vx: 680, vy: -320, omega: 16, pace: 680 });
          }
        },
        {
          id: 'ubu-move-wobble',
          title: 'Moving Ubu Wobble (Speed, Mass & Size)',
          when: 'Skaters glide above 28 px/s (`playUbuMove` modulated by speed, mass, and radius).',
          visual: 'Speed-pitched movement wobble (+50% boost) per skater: inaudible at rest, fluttering higher and faster for small light ubus and humming deeper with warm low-mid weight for large heavy ubus.',
          soundLabel: 'Play ubu wobble',
          variants: [
            { id: 'six', label: '6-Ubu Live Mix' },
            { id: 'small', label: 'Small & Light Ubu' },
            { id: 'heavy', label: 'Large & Heavy Ubu' }
          ],
          duration: 2.8,
          playSound: (ctx, variant = 'six') => {
            if (variant === 'small') ctx.audio()?.playUbuMove?.({ speed: 580, mass: 2.45, radius: 17, duration: 0.9, preview: true });
            else if (variant === 'heavy') ctx.audio()?.playUbuMove?.({ speed: 520, mass: 4.8, radius: 38, duration: 0.95, preview: true });
            else ctx.audio()?.playUbuMove?.({ speed: 540, mass: 3.0, radius: 25, duration: 0.9, preview: true });
          },
          run: (ctx, variant = 'six') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(6, 500, 88);
            if (variant === 'small') {
              ctx.boostStats(0, { size: 0, mass: 0 });
              ctx.place(0, 160, 300, { vx: 640, vy: 0 });
            } else if (variant === 'heavy') {
              ctx.boostStats(0, { size: 255, mass: 255 });
              ctx.place(0, 160, 300, { vx: 580, vy: 0 });
            } else {
              ctx.boostStats(0, { size: 10, mass: 20 });
              ctx.boostStats(1, { size: 127, mass: 127 });
              ctx.boostStats(2, { size: 250, mass: 250 });
              ctx.place(0, 170, 170, { vx: 620, vy: 40 });
              ctx.place(1, 170, 300, { vx: 520, vy: -30 });
              ctx.place(2, 170, 430, { vx: 460, vy: -40 });
              ctx.place(3, 830, 210, { vx: -560, vy: 50 });
              ctx.place(4, 830, 350, { vx: -480, vy: -40 });
              ctx.place(5, 500, 470, { vx: 390, vy: -80 });
            }
          }
        },
        {
          id: 'ball-puck-slide',
          title: 'Moving Ball Hockey Puck Slide',
          when: 'Free ball glides across the ice above 30 px/s (`playPuckSlide`).',
          visual: 'Quiet, sleek hockey-puck ice glide that smoothly tracks and pans across the rink with speed and spin.',
          soundLabel: 'Play puck slide',
          variants: [
            { id: 'fast', label: 'Fast Crisp Glide' },
            { id: 'curve', label: 'Spinning Curve Slide' }
          ],
          duration: 2.6,
          playSound: (ctx, variant = 'fast') =>
            ctx.audio()?.playPuckSlide?.({ speed: variant === 'curve' ? 620 : 540, spin: variant === 'curve' ? 20 : 0, duration: 0.95 }),
          run: (ctx, variant = 'fast') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(0, 180, 130);
            ctx.place(1, 180, 470);
            ctx.place(3, 820, 130);
            ctx.place(4, 820, 470);
            ctx.place(5, 500, 480);
            if (variant === 'curve') {
              ctx.place(6, 170, 390, { vx: 650, vy: -190, omega: 20, pace: 650 });
            } else {
              ctx.place(6, 160, 300, { vx: 660, vy: 35, omega: 3, pace: 660 });
            }
          }
        },
        {
          id: 'spin-wobble-taper',
          title: 'Spinning Wobble & Extended Crescent Swirls',
          when: 'Skaters or ball spin with `|omega| >= 2.5 rad/s` (`drawSpin`) and skaters spin above `2.8 rad/s` (`playSpin` modulated by spin speed and radius).',
          visual: 'Long, sleek crescent spin swirls with a gentle tail fade and streamlined leading tip showing CW vs. CCW direction, paired with a continuous spin-speed-modulated wobble (inaudible below threshold, scaling smoothly in volume, pitch, and 3.2-16 Hz flutter rate at higher spin speeds without a start transient).',
          soundLabel: 'Play spin wobble',
          variants: [
            { id: 'compare', label: 'CW vs. CCW Direction' },
            { id: 'high-low', label: 'High Spin vs. Low Spin' }
          ],
          duration: 2.8,
          playSound: (ctx, variant = 'compare') =>
            ctx.audio()?.playSpin?.({ omega: variant === 'high-low' ? 18 : 14, radius: 25, duration: 0.95, preview: true }),
          run: (ctx, variant = 'compare') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(2, 180, 470);
            ctx.place(4, 820, 130);
            ctx.place(5, 820, 470);
            if (variant === 'high-low') {
              ctx.place(0, 300, 230, { vx: 210, vy: 0, omega: 18 });
              ctx.place(1, 300, 385, { vx: 210, vy: 0, omega: 5.5 });
              ctx.place(3, 720, 300);
              ctx.place(6, 560, 300, { vx: 90, vy: 0, omega: -18 });
            } else {
              // Skater 0 spins clockwise (+omega), Away Skater 3 spins counter-clockwise (-omega)
              ctx.place(0, 330, 300, { vx: 90, vy: -30, omega: 16 });
              ctx.place(3, 670, 300, { vx: -90, vy: 30, omega: -16 });
              ctx.place(1, 500, 175, { vx: 0, vy: 0, omega: 12 });
              ctx.place(6, 500, 425, { vx: 0, vy: 0, omega: -15 });
            }
          }
        },
        {
          id: 'ice-skids',
          title: 'Hard Braking & Ice Skid Marks',
          when: 'Sharp speed drop (`slowed > 220 px/s`) from Guard braking or heavy collision (`markIce`, `paintIce`, `playCarve`).',
          visual: 'Softly feathered dark ice gouges with rounded, fading ends (`SKID_LIFE = 12s`) paired with an ice-hockey blade shave & snow-spray stop sound.',
          soundLabel: 'Play ice brake',
          duration: 2.5,
          playSound: ctx => ctx.audio()?.playCarve({ volume: 0.5 }),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(0, 210, 240, { vx: 700, vy: 40 });
            ctx.place(1, 210, 380, { vx: 680, vy: -35 });
            ctx.place(3, 520, 255, { vx: -420, vy: 0, guarding: true });
            ctx.P.syncEffectiveStats(ctx.bodies[3]);
            // Schedule a sharp mid-stride brake on skater 1 to demonstrate pure braking skid + ice stop sound
            ctx.after(0.18, () => {
              const b = ctx.bodies[1];
              b.guarding = true;
              b.vx *= 0.2;
              b.vy *= 0.2;
              ctx.P.syncEffectiveStats(b);
            });
          }
        },
        {
          id: 'corner-carve',
          title: 'Corner Rim-Around & Board Spring (Skate Edge Carve)',
          when: 'Skater skims a 100 px curved corner arc (`vn <= 190`, `|vt| >= 150`) with co-rotating spin (`rimmed = true`, redirecting Board Spring rebound along the glass).',
          visual: 'Stream of glowing friction sparks & streak sparks (`#fff1c1` / `#fff3b0` / `#ffc43d` / `#ffb347` / `#ff7a1a`) like the hot ball spraying backward from the skate edge, softly feathered curved corner skid gouge, and speed-pitched edge-bite carve sound.',
          soundLabel: 'Play edge-bite carve',
          duration: 2.4,
          playSound: ctx => ctx.audio()?.playCarve({ volume: 0.55, speed: 500, rimmed: true }),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            // Top-left corner (center 160,160, radius 100): moving left along top wall (vt > 0 -> negative omega co-rotates)
            ctx.place(0, 220, 86, { vx: -480, vy: -35, omega: -14, spinStrike: 1 });
            // Bottom-right corner: second skater carving opposite corner
            ctx.place(3, 780, 514, { vx: 480, vy: 35, omega: -14, spinStrike: 1 });
            ctx.place(6, 500, 300);
          }
        },
        {
          id: 'slipstream-draft',
          title: 'Tailgating & Pack Draft (Front Wind Cone & Slipstream)',
          when: 'Skater drafts behind any fast skater (`tailgateFactor > 0.22` cone, `> 0.35` wind; Pack Draft boosts teammate Synergy × Chemistry wake up to 65% friction cut).',
          visual: 'Translucent pale-cyan aerodynamic wind cone parting around the front of the drafting ubu, wake streaks, and continuous rushing wind.',
          soundLabel: 'Play slipstream wind',
          duration: 2.6,
          playSound: ctx => ctx.audio()?.playSlipstream({ draft: 0.85, volume: 0.75, duration: 1.0 }),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(1, 260, 260, { vx: 580, vy: 0 });
            ctx.place(0, 196, 260, { vx: 500, vy: 0 });
            ctx.place(4, 740, 360, { vx: -580, vy: 0 });
            ctx.place(3, 804, 360, { vx: -500, vy: 0 });
            ctx.place(6, 500, 130);
          }
        },
        {
          id: 'material-particles',
          title: 'Rare DNA Material Trail Particles (32 Finishes)',
          when: 'Skaters with rare DNA material attributes move above 25 px/s (`MATERIAL_STYLES` emitter).',
          visual: 'Emits `spark`, `bubble`, `shard`, `dust`, `chip`, or `streak` particles (including rainbow shimmers) matching the Material picker.',
          variants: [
            { id: 'selected', label: 'Selected Material Picker' },
            { id: 'all-shapes', label: 'All 6 Shapes Showcase' }
          ],
          duration: 3.0,
          run: (ctx, variant = 'selected') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            if (variant === 'all-shapes') {
              const showcase = ['iridescent', 'opalescent', 'holographic', 'sandstone', 'mosaic', 'kintsugi'];
              showcase.forEach((mat, i) => ctx.setSkaterMaterial(i, mat));
            } else {
              const mat = ctx.getSelectedMaterial() || 'iridescent';
              for (let i = 0; i < 6; i++) ctx.setSkaterMaterial(i, i === 0 ? mat : (i === 3 ? 'lava' : mat));
            }
            ctx.place(0, 180, 180, { vx: 520, vy: 110, omega: 8 });
            ctx.place(1, 180, 300, { vx: 540, vy: -40, omega: -7 });
            ctx.place(2, 180, 420, { vx: 510, vy: -120, omega: 8 });
            ctx.place(3, 820, 180, { vx: -520, vy: 120, omega: -8 });
            ctx.place(4, 820, 300, { vx: -540, vy: 40, omega: 7 });
            ctx.place(5, 820, 420, { vx: -510, vy: -110, omega: -8 });
          }
        },
        {
          id: 'pulse-bar',
          title: 'Pulse Mode 1s Turn Progress Bar',
          when: 'Active 1-second turn in Pulse mode (`drawFieldOver` `#DA4DB5` bottom strip).',
          visual: 'Magenta progress bar along `y = 556` filling over 1.0s before freezing momentum into the tinted Pulse planning state.',
          duration: 2.2,
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'pulse' });
            ctx.place(0, 220, 230, { vx: 460, vy: 60 });
            ctx.place(1, 300, 410, { vx: 420, vy: -120 });
            ctx.place(3, 760, 260, { vx: -430, vy: 80 });
            ctx.place(6, 480, 300, { vx: 380, vy: -140, pace: 380 });
          }
        },
        {
          id: 'pulse-adjustments',
          title: 'Pulse Turn Resume: Coast vs. Sideways Cut vs. Guard Brake',
          when: 'Resuming from a quiet Pulse turn boundary with 0% power (`coast`), cross-momentum steering (`cut`), or Guard braking (`brake`).',
          visual: 'Quiet turn boundary: coasting keeps smooth unbroken glide hiss; steering carves outside-edge snow spray (`playCarve` `cut`); Guard cuts glide hiss short with a forward snow-stop plume & front shield flex (`brake: true`).',
          soundLabel: 'Play cut / brake',
          variants: [
            { id: 'all-three', label: 'Compare All 3 Side-by-Side' },
            { id: 'coast', label: 'Coast (Unbroken Glide Hiss)' },
            { id: 'cut', label: 'Steer Across Momentum (Edge Carve)' },
            { id: 'brake', label: 'Guard Brake (Hockey Stop Spray)' }
          ],
          duration: 2.2,
          playSound: (ctx, variant = 'all-three') => {
            if (variant === 'coast') ctx.audio()?.playUbuMove?.({ speed: 540, duration: 0.75 });
            else if (variant === 'brake') ctx.audio()?.playCarve?.({ brake: true, speed: 580, volume: 0.75 });
            else ctx.audio()?.playCarve?.({ cut: 0.9, speed: 560, volume: 0.68 });
          },
          run: (ctx, variant = 'all-three') => {
            ctx.resetStage({ phase: 'play', mode: 'pulse' });
            ctx.place(6, 780, 300);
            ctx.place(3, 860, 140);
            ctx.place(4, 860, 460);
            ctx.place(5, 890, 300);
            if (variant === 'coast') {
              ctx.place(0, 170, 300, { vx: 540, vy: 0 });
              ctx.place(1, 140, 110);
              ctx.place(2, 140, 490);
              ctx.after(0.45, () => {
                const next = ctx.idlePlans();
                ctx.P.startTurn(ctx.bodies, next, ctx.liveFx.super, ctx.liveFx.launch);
              });
            } else if (variant === 'cut') {
              ctx.place(0, 180, 360, { vx: 560, vy: 20 });
              ctx.place(1, 140, 110);
              ctx.place(2, 140, 490);
              ctx.after(0.42, () => {
                const next = ctx.idlePlans();
                next[0] = { angle: -Math.PI * 0.44, power: 1.0, spin: 0.35, guard: false };
                ctx.P.startTurn(ctx.bodies, next, ctx.liveFx.super, ctx.liveFx.launch);
              });
            } else if (variant === 'brake') {
              ctx.place(0, 180, 300, { vx: 600, vy: 0 });
              ctx.place(1, 140, 110);
              ctx.place(2, 140, 490);
              ctx.after(0.42, () => {
                const next = ctx.idlePlans();
                next[0] = { angle: 0, power: 0, spin: 0, guard: true };
                ctx.P.startTurn(ctx.bodies, next, ctx.liveFx.super, ctx.liveFx.launch);
              });
            } else {
              // Top skater coasts smoothly, middle skater cuts sharply upward-right, bottom skater slams Guard brake!
              ctx.place(0, 170, 155, { vx: 520, vy: 0 });
              ctx.place(1, 170, 315, { vx: 560, vy: 35 });
              ctx.place(2, 170, 455, { vx: 590, vy: 0 });
              ctx.after(0.44, () => {
                const next = ctx.idlePlans();
                next[0] = { angle: 0, power: 0, spin: 0, guard: false };
                next[1] = { angle: -Math.PI * 0.42, power: 1.0, spin: 0.3, guard: false };
                next[2] = { angle: 0, power: 0, spin: 0, guard: true };
                ctx.P.startTurn(ctx.bodies, next, ctx.liveFx.super, ctx.liveFx.launch);
              });
            }
          }
        }
      ]
    },
    {
      id: 'impacts',
      title: '4. Shots, Impacts & Ball Heat',
      summary: 'Ordinary shot tactility, Reach sweet-spot vs. toe-poke, Tape-to-Tape catches, weight-class bumps, board spin-bite chirps, Strikes, Snaps, and Fireballs.',
      items: [
        {
          id: 'ordinary-shot-tactility',
          title: 'Ordinary Shot Lab: Clean Strike, Glancing Graze, Braced Save & 6-Skater Scrum',
          when: 'Every ordinary ball touch (`contactMarks`, `ballTapWarp`, `playBallHit` `graze`/`poke`, `guardFlexes`, `playGuardHit`). Test with Mute sound ON or eyes closed!',
          visual: 'Square hit flattens a bright contact mark on the struck ball face with a solid tap; graze skims sideways with a thin shik & ducked voice; Reach poke glints the outer ring; Guard dents inward on the struck side.',
          soundLabel: 'Play tap / shik / brace',
          variants: [
            { id: 'clean-strike', label: '1. Clean Square Strike (Flat Tap)' },
            { id: 'glancing-graze', label: '2. Glancing Graze (Thin Shik)' },
            { id: 'braced-save', label: '3. Braced Guard Save (Shield Flex)' },
            { id: 'poke-reach', label: 'Extended Reach Poke-Touch Glint' },
            { id: 'six-scrum', label: '6-Skater Scramble Readability Test' }
          ],
          duration: 2.3,
          playSound: (ctx, variant = 'clean-strike') => {
            if (variant === 'glancing-graze') {
              ctx.audio()?.playBallHit?.({ volume: 0.85, graze: 0.92, x: 500, y: 300 });
            } else if (variant === 'braced-save') {
              ctx.audio()?.playGuardHit?.({ strength: 0.85, graze: 0.08, volume: 0.92, x: 260, y: 300 });
              ctx.audio()?.playBallHit?.({ volume: 0.78, graze: 0.08, x: 260, y: 300 });
            } else if (variant === 'poke-reach') {
              ctx.audio()?.playBallHit?.({ volume: 0.78, graze: 0.35, poke: true, x: 500, y: 300 });
            } else {
              ctx.audio()?.playBallHit?.({ volume: 0.88, graze: 0.02, x: 500, y: 300 });
            }
          },
          run: (ctx, variant = 'clean-strike') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            if (variant === 'clean-strike') {
              // Moderate speed (<840 px/s so no fireball, >2 ball diameters gap at launch so ordinary touch, not point-blank strike)
              ctx.place(1, 200, 120);
              ctx.place(2, 200, 480);
              ctx.place(3, 820, 140);
              ctx.place(4, 820, 460);
              ctx.place(5, 860, 140);
              ctx.place(0, 320, 300, { vx: 560, vy: 0 });
              ctx.place(6, 470, 300, { vx: 0, vy: 0 });
            } else if (variant === 'glancing-graze') {
              // Skater clips the top edge of the ball tangentially — watch the ball kick downward-right with a thin sideways shik!
              ctx.place(1, 200, 120);
              ctx.place(2, 200, 480);
              ctx.place(3, 820, 140);
              ctx.place(4, 820, 460);
              ctx.place(5, 860, 460);
              ctx.place(0, 340, 264, { vx: 580, vy: 0 });
              ctx.place(6, 470, 300, { vx: 0, vy: 0 });
            } else if (variant === 'poke-reach') {
              // High-Reach compact skater catches a passing ball cleanly with the outer Reach ring outside its body silhouette
              ctx.boostStats(0, { size: 40, reach: 255 });
              ctx.place(1, 200, 120);
              ctx.place(2, 200, 480);
              ctx.place(3, 820, 140);
              ctx.place(4, 820, 460);
              ctx.place(5, 860, 460);
              ctx.place(0, 460, 350, { vx: 120, vy: 0 });
              ctx.place(6, 340, 302, { vx: 520, vy: 0, strikerTeam: 1 });
            } else if (variant === 'braced-save') {
              // Same incoming shot met squarely by a planted Guarding defender
              ctx.boostStats(0, { stability: 210, mass: 200 });
              ctx.bodies[0].guarding = true;
              ctx.P.syncEffectiveStats(ctx.bodies[0]);
              ctx.place(0, 235, 300);
              ctx.place(1, 220, 130);
              ctx.place(2, 220, 470);
              ctx.place(3, 720, 300);
              ctx.place(6, 420, 300, { vx: -620, vy: 0, pace: 620, strikerTeam: 1 });
              ctx.play.credit[3] = 1;
              ctx.play.last = 3;
            } else {
              // 6-skater scramble: thin graze -> braced midfield Guard knock -> clean square strike out of traffic!
              ctx.bodies[1].guarding = true;
              ctx.P.syncEffectiveStats(ctx.bodies[1]);
              ctx.place(0, 350, 266, { vx: 560, vy: 15 });   // Grazes ball downward-right
              ctx.place(4, 545, 348, { vx: -120, vy: -40 }); // Opponent body in traffic
              ctx.bodies[4].guarding = true;
              ctx.P.syncEffectiveStats(ctx.bodies[4]);       // Braced opponent Guard takes deflected hit
              ctx.place(1, 430, 385);                        // Braced home Guard absorbs check/rebound
              ctx.place(2, 365, 420, { vx: 460, vy: -155 }); // Arrives for clean square follow-up strike
              ctx.place(3, 560, 235, { vx: -420, vy: 130 });
              ctx.place(5, 620, 320, { vx: -360, vy: -45 });
              ctx.place(6, 465, 300, { vx: -60, vy: 0 });
            }
          }
        },
        {
          id: 'sweet-spot-vs-toepoke',
          title: 'Reach Sweet Spot: Body-Core Punch vs. Outstretched Toe-Poke',
          when: 'Striking flush on the body core (`pokeFrac = 0`, 100% power) vs. catching the ball out on the extended Reach ring (`pokeFrac -> 1`, `SWEET_SPOT` tip falloff).',
          visual: 'Flush center-body hit gives a chesty sweet-spot thump, inner white core flash, and crisp shooter follow-through; outstretched toe-poke leaves the body un-jarred and bows only the Reach ring outward with a lighter, higher tip click.',
          soundLabel: 'Play core / toe-poke',
          variants: [
            { id: 'compare-seq', label: 'Compare Sequence: Core Punch -> Tip Toe-Poke' },
            { id: 'flush-core', label: 'Flush Body-Core Sweet Spot (Full Punch)' },
            { id: 'tip-toepoke', label: 'Outstretched Reach Toe-Poke (Ring Bow)' }
          ],
          duration: 2.5,
          playSound: (ctx, variant = 'compare-seq') => {
            if (variant === 'flush-core') {
              ctx.audio()?.playBallHit?.({ volume: 0.90, graze: 0.02, poke: false, pokeFrac: 0, x: 470, y: 300 });
            } else if (variant === 'tip-toepoke') {
              ctx.audio()?.playBallHit?.({ volume: 0.84, graze: 0.12, poke: true, pokeFrac: 0.95, x: 470, y: 300 });
            } else {
              ctx.audio()?.playBallHit?.({ volume: 0.90, graze: 0.02, poke: false, pokeFrac: 0, x: 360, y: 240 });
              setTimeout(() => ctx.audio()?.playBallHit?.({ volume: 0.84, graze: 0.12, poke: true, pokeFrac: 0.95, x: 640, y: 360 }), 420);
            }
          },
          run: (ctx, variant = 'compare-seq') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(2, 160, 490);
            ctx.place(3, 850, 140);
            ctx.place(4, 850, 460);
            ctx.place(5, 880, 300);
            if (variant === 'flush-core') {
              ctx.boostStats(0, { size: 165, reach: 95, power: 190 });
              ctx.place(1, 160, 110);
              ctx.place(0, 320, 300, { vx: 560, vy: 0 });
              ctx.place(6, 470, 300, { vx: 0, vy: 0 });
            } else if (variant === 'tip-toepoke') {
              // Compact skater with huge Reach ring catches passing ball right at the outer Reach tip!
              ctx.boostStats(0, { size: 15, reach: 255, power: 190 });
              ctx.place(1, 160, 110);
              ctx.place(0, 455, 353, { vx: 80, vy: 0 });
              ctx.place(6, 330, 300, { vx: 490, vy: 0, strikerTeam: 1 });
            } else {
              // Step 1 (0.22s): Skater 0 drills the ball flush on body core; Step 2 (1.05s): reset ball across Skater 1's outstretched Reach tip!
              ctx.boostStats(0, { size: 165, reach: 95, power: 190 });
              ctx.boostStats(1, { size: 15, reach: 255, power: 190 });
              ctx.place(0, 250, 215, { vx: 560, vy: 0 });
              ctx.place(1, 610, 413, { vx: 0, vy: 0 });
              ctx.place(6, 390, 215, { vx: 0, vy: 0 });
              ctx.after(1.05, () => {
                ctx.place(1, 610, 413, { vx: 75, vy: 0 });
                ctx.place(6, 485, 360, { vx: 490, vy: 0, omega: 0, strikerTeam: 1, onFire: false, fireTicks: 0, pace: 200 });
              });
            }
          }
        },
        {
          id: 'tape-to-tape-catch',
          title: 'Teammate "Tape-to-Tape" Catch vs. Opponent Ricochet',
          when: 'Non-guarding teammate cleanly receives a live teammate pass (`passerSlot >= 0`, `>=140 px/s`) below full Snap One-Timer threshold.',
          visual: 'Warm cupped composite-blade "thup" pocket catch, twin concentric team-colored rings around the ball, white receiver-rim catch arc, and brief dashed pass-thread shimmer back to the passer.',
          soundLabel: 'Play cupped catch',
          variants: [
            { id: 'tape-catch', label: 'Live Teammate Reception (Cupped Thup)' },
            { id: 'ricochet-control', label: 'Opponent Deflection Control (Brittle Tap)' },
            { id: 'give-and-go', label: '3-Skater Tape-to-Tape Relay Triangle' }
          ],
          duration: 2.5,
          playSound: (ctx, variant = 'tape-catch') => {
            if (variant === 'ricochet-control') {
              ctx.audio()?.playBallHit?.({ volume: 0.82, graze: 0.15, tape: false, x: 520, y: 300 });
            } else {
              ctx.audio()?.playBallHit?.({ volume: 0.84, graze: 0.10, tape: true, x: 520, y: 300 });
            }
          },
          run: (ctx, variant = 'tape-catch') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(3, 840, 140);
            ctx.place(4, 840, 460);
            ctx.place(5, 870, 300);
            if (variant === 'give-and-go') {
              // Skater 1 passes down-right to stationary/gliding Skater 0 (Tape-to-Tape #1), angled toward gliding Skater 2 (Tape-to-Tape #2)!
              ctx.place(1, 250, 165, { vx: 40, vy: 20 });
              ctx.place(0, 455, 355, { vx: 35, vy: -35 }); // <140 drive so cushioned Tape-to-Tape catch, not Snap!
              ctx.place(2, 665, 205, { vx: 55, vy: 20 });
              ctx.place(6, 305, 205, { vx: 330, vy: 245, pace: 410, strikerTeam: 0, strikerSlot: 1 });
              ctx.play.last = 1;
            } else {
              const fromTeammate = variant !== 'ricochet-control';
              ctx.place(1, 250, 210, { vx: 30, vy: 15 });
              ctx.place(2, 220, 460);
              if (!fromTeammate) ctx.place(3, 250, 210, { vx: 20, vy: 10 });
              ctx.place(0, 520, 318, { vx: 45, vy: -30 }); // Drive below SNAP.minDrive (140) so pure Tape-to-Tape reception
              ctx.place(6, 335, 242, {
                vx: 380, vy: 145, pace: 405,
                strikerTeam: fromTeammate ? 0 : 1,
                strikerSlot: fromTeammate ? 1 : 0
              });
              ctx.play.last = fromTeammate ? 1 : 3;
            }
          }
        },
        {
          id: 'weight-class-bumps',
          title: 'Weight-Class Shoulder Bumps & Asymmetric Stonewall',
          when: 'Skaters jostle or check in open ice (`playBodyBump`, asymmetric `knockA`/`knockB` `ubuRecoils` squash & brace).',
          visual: 'Heavyweight stonewall barely yields and flashes a white shoulder-brace arc while the lightweight runner compresses and recoils; audio shifts from nimble jersey brush on featherweights to a deep sub-bass pad thud on heavyweights.',
          soundLabel: 'Play pad thud / brush',
          variants: [
            { id: 'stonewall', label: 'Heavyweight Stonewall vs. Featherweight' },
            { id: 'heavy-clash', label: 'Two Heavyweights (Deep Pad Thud)' },
            { id: 'feather-jostle', label: 'Two Featherweights (Light Jersey Brush)' }
          ],
          duration: 2.3,
          playSound: (ctx, variant = 'stonewall') => {
            if (variant === 'feather-jostle') {
              ctx.audio()?.playBodyBump?.({ speed: 280, massA: 2.3, massB: 2.3, asymmetry: 0.05, volume: 0.72, x: 500, y: 300 });
            } else if (variant === 'heavy-clash') {
              ctx.audio()?.playBodyBump?.({ speed: 360, massA: 4.8, massB: 4.8, asymmetry: 0.08, volume: 0.88, x: 500, y: 300 });
            } else {
              ctx.audio()?.playBodyBump?.({ speed: 380, massA: 4.8, massB: 2.3, asymmetry: 0.78, volume: 0.88, x: 500, y: 300 });
            }
          },
          run: (ctx, variant = 'stonewall') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(1, 180, 125);
            ctx.place(2, 180, 475);
            ctx.place(4, 820, 125);
            ctx.place(5, 820, 475);
            ctx.place(6, 500, 110);
            if (variant === 'feather-jostle') {
              ctx.boostStats(0, { size: 0, mass: 0, strength: 60, stability: 70 });
              ctx.boostStats(3, { size: 0, mass: 0, strength: 60, stability: 70 });
              ctx.place(0, 415, 300, { vx: 230, vy: 12 });
              ctx.place(3, 555, 304, { vx: -220, vy: -12 });
            } else if (variant === 'heavy-clash') {
              ctx.boostStats(0, { size: 255, mass: 255, strength: 220, stability: 220 });
              ctx.boostStats(3, { size: 255, mass: 255, strength: 220, stability: 220 });
              ctx.place(0, 395, 300, { vx: 280, vy: 0 });
              ctx.place(3, 575, 300, { vx: -280, vy: 0 });
            } else {
              // Home Skater 0 is an anchored Heavyweight tank; Away Skater 3 is a fast Featherweight runner bouncing off!
              ctx.boostStats(0, { size: 250, mass: 255, strength: 255, stability: 255 });
              ctx.boostStats(3, { size: 5, mass: 0, strength: 25, stability: 15 });
              ctx.place(0, 445, 300, { vx: 55, vy: 0 });
              ctx.place(3, 595, 302, { vx: -470, vy: 0 });
            }
          }
        },
        {
          id: 'body-check-daze',
          title: 'Body Check, Hip Clip & Daze Dizzy Swirl',
          when: 'Opposing skaters collide (`isCheck` above 65 px/s, `knock > 250 px/s` dazes past 15%), or a glancing Hip Clip (`tangentImpulse >= 55`) shears past an opponent.',
          visual: 'Strength-scaled dual-team check compression arcs & sparks (with `#c3cbff` daze spiral on heavy hits), or a strength-scaled Hip Clip rotational shear wave, tangential slip-streaks, and whip-whoosh sound (`crack: false`).',
          soundLabel: 'Play check / whip',
          variants: [
            { id: 'daze', label: 'Heavy Check + Daze Swirl' },
            { id: 'light-check', label: 'Light Check (Scaled Arc)' },
            { id: 'hip-clip', label: 'Strong Hip Clip + Whip' },
            { id: 'light-hip-clip', label: 'Light Hip Clip (Subtle Shear)' }
          ],
          duration: 2.5,
          playSound: (ctx, variant = 'daze') => {
            const isHip = variant === 'hip-clip' || variant === 'light-hip-clip';
            const strong = variant === 'daze' || variant === 'hip-clip';
            ctx.audio()?.playCollision(ctx.voice(), { volume: strong ? 0.9 : 0.45 });
            if (isHip) ctx.audio()?.playSpinStrike?.({ volume: strong ? 0.85 : 0.48, spin: strong ? 16 : 8, crack: false });
          },
          run: (ctx, variant = 'daze') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(6, 500, 110);
            if (variant === 'hip-clip') {
              ctx.place(0, 330, 290, { vx: 640, vy: 0 });
              ctx.place(3, 470, 326, { vx: -280, vy: 0 });
            } else if (variant === 'light-hip-clip') {
              ctx.place(0, 355, 292, { vx: 290, vy: 0 });
              ctx.place(3, 455, 328, { vx: -110, vy: 0 });
            } else if (variant === 'light-check') {
              ctx.place(0, 360, 300, { vx: 210, vy: 0 });
              ctx.place(3, 445, 300, { vx: -60, vy: 0 });
            } else {
              ctx.boostStats(0, { mass: 255, strength: 255, impulse: 240 });
              ctx.boostStats(3, { stability: 0, mass: 30 });
              ctx.bodies[3].daze = 0.2; // Prior check so this hit pushes clearly into visible daze swirl
              ctx.place(0, 340, 300, { vx: 660, vy: 0 });
              ctx.place(3, 450, 300, { vx: -120, vy: 0 });
            }
          }
        },
        {
          id: 'spin-strike',
          title: 'Point-Blank Strike & Spin Strike (`"Spin strike!"`)',
          when: 'Skater (>=180 px/s) touches the ball first within 2 ball diameters: always boosts shot speed & cracks (`struck`, `playSpinStrike`), and upgrades to `"Spin strike!"` with ubu twirl when `|omega| >= 10 rad/s` (`tick.struck`, `playSpinTwirl`).',
          visual: 'Plain point-blank strike emits a crisp team-colored impact ring, flash, directional streaks, hit-stop, and bullwhip crack (no popup); Spin Strike (`>=10 rad/s`) upgrades to twin rotating swirl-blade shockwaves, a 3-blade twirl vortex over the striking ubu (`s.spinTwirl`), `playSpinTwirl`, and `"Spin strike!"` callout.',
          soundLabel: 'Play strike / twirl',
          variants: [
            { id: 'spin', label: 'Spin Strike (>=10 rad/s)' },
            { id: 'plain', label: 'Point-Blank Strike (No Spin)' }
          ],
          duration: 2.5,
          playSound: (ctx, variant = 'spin') => {
            ctx.audio()?.playSpinStrike?.({ volume: 0.92, spin: variant === 'spin' ? 16 : 0 });
            if (variant === 'spin') ctx.audio()?.playSpinTwirl?.({ volume: 0.92, spin: 16 });
            ctx.audio()?.playBallHit({ volume: 0.9, snap: false });
          },
          run: (ctx, variant = 'spin') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(0, 380, variant === 'spin' ? 310 : 300);
            ctx.place(6, 434, 300);
            ctx.place(3, 780, 140);
            ctx.place(4, 780, 460);
            const plans = ctx.idlePlans();
            plans[0] = variant === 'spin'
              ? { angle: -0.14, power: 0.95, spin: 1.0, guard: false }
              : { angle: 0, power: 0.95, spin: 0, guard: false };
            ctx.launchPlans(plans);
          }
        },
        {
          id: 'snap-one-timer',
          title: 'Snap One-Timer & Tape-to-Tape Redirect (Team Colors)',
          when: 'Non-guarding skater (>=140 px/s) redirects a live teammate pass (>=180 px/s, `snapped = true`, scaled by passer Synergy × shooter Chemistry).',
          visual: 'Team-colored shockwave ring, contact flash, and 20 directional & V-wing team-colored streaks/sparks, +30 fire pre-heat ticks, and 60-100ms hit-stop.',
          soundLabel: 'Play snap crack',
          variants: [
            { id: 'home', label: 'Home Team Snap' },
            { id: 'away', label: 'Away Team Snap' }
          ],
          duration: 2.4,
          playSound: ctx => ctx.audio()?.playBallHit({ volume: 1.0, snap: true }),
          run: (ctx, variant = 'home') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            if (variant === 'away') {
              ctx.place(4, 570, 140, { vx: -40, vy: 40 });
              ctx.place(6, 505, 225, { vx: -30, vy: 340, pace: 340, strikerTeam: 1, strikerSlot: 1 });
              ctx.play.last = 4;
              ctx.place(3, 595, 305, { vx: -540, vy: -20 });
              ctx.place(0, 190, 150);
              ctx.place(1, 190, 450);
            } else {
              ctx.place(1, 430, 140, { vx: 40, vy: 40 });
              ctx.place(6, 495, 225, { vx: 30, vy: 340, pace: 340, strikerTeam: 0, strikerSlot: 1 });
              ctx.play.last = 1;
              ctx.place(0, 405, 305, { vx: 540, vy: -20 });
              ctx.place(3, 810, 150);
              ctx.place(4, 810, 450);
            }
          }
        },
        {
          id: 'board-ripple',
          title: 'Board Flex Bulge & Hockey Wall Thock',
          when: 'Body or ball hits rink boards (`addWallEffect` > 220 px/s, `playWallHit` hollow thock on hard hits >= 370 px/s).',
          visual: 'Damped outward cosine bulge along `BOARD_RUNS`, tangent spark burst, restrained knock on light hits, and a deep hollow dasher-board "thock" reserved for truly hard impacts.',
          soundLabel: 'Play board hit',
          variants: [
            { id: 'hard', label: 'Hard Hit (Deep Thock)' },
            { id: 'light', label: 'Light Hit (No Thock)' }
          ],
          duration: 2.2,
          playSound: (ctx, variant = 'hard') =>
            ctx.audio()?.playWallHit(variant === 'light' ? { volume: 0.36, speed: 240 } : { volume: 0.82, speed: 600 }),
          run: (ctx, variant = 'hard') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            const vy = variant === 'light' ? 255 : 590;
            ctx.place(0, 380, 130, { vx: 160, vy: -vy });
            ctx.place(3, 620, 470, { vx: -160, vy });
            ctx.place(6, 500, 160, { vx: 140, vy: -(vy + 30), pace: vy + 30 });
          }
        },
        {
          id: 'board-spin-bite',
          title: 'Board Spin-Bite Chirp & Corner Counter-Rim Scuff',
          when: 'Spinning ball or skater grabs the dasher glass (`spinBite` friction impulse in `reflect`) or counter-spin fights a corner rim-around (`counterScuff`).',
          visual: 'Heavy spin stamps an angled tangential smudge & directional sparks along the boards with a rubber-on-glass chirp as the bank kicks wide; counter-spin in a corner puffs white scrub dust with a choked kickplate scuff-check.',
          soundLabel: 'Play chirp / scuff',
          variants: [
            { id: 'english-chirp', label: 'Heavy Spin Bank (Rubber Chirp & Wide Kick)' },
            { id: 'flat-bank', label: 'No-Spin Bank Control (Straight Bounce)' },
            { id: 'counter-scuff', label: 'Counter-Spin Corner Check (Kickplate Scuff)' }
          ],
          duration: 2.3,
          playSound: (ctx, variant = 'english-chirp') => {
            if (variant === 'flat-bank') {
              ctx.audio()?.playWallHit?.({ volume: 0.72, speed: 460, spinBite: 0, scuff: 0, x: 500, y: 60 });
            } else if (variant === 'counter-scuff') {
              ctx.audio()?.playWallHit?.({ volume: 0.72, speed: 340, spinBite: 0, scuff: 0.92, x: 110, y: 90 });
            } else {
              ctx.audio()?.playWallHit?.({ volume: 0.76, speed: 470, spinBite: 0.92, scuff: 0, x: 500, y: 60 });
            }
          },
          run: (ctx, variant = 'english-chirp') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(1, 200, 470);
            ctx.place(2, 340, 470);
            ctx.place(3, 820, 460);
            ctx.place(4, 820, 140);
            ctx.place(5, 680, 470);
            if (variant === 'counter-scuff') {
              // Top-left corner arc (x < 160, y < 160): moving counter-clockwise (vt < 0) while negative -omega fights the corner and scrubs speed!
              ctx.place(0, 152, 114, { vx: -440, vy: -210, omega: -19 });
              ctx.place(6, 500, 300);
            } else {
              const withSpin = variant !== 'flat-bank';
              ctx.place(0, 330, 180, { vx: 120, vy: -410, omega: withSpin ? 19 : 0 });
              ctx.place(6, 520, 175, { vx: 90, vy: -460, omega: withSpin ? 22 : 0, pace: 470 });
            }
          }
        },
        {
          id: 'post-ping',
          title: 'Goalpost Ring, Post Shiver & Post English Zing-Ping',
          when: 'Fast spinning shot strikes a goalpost (`wallType === "post"`, >=300 px/s triggers 40ms hit-stop).',
          visual: 'High-frequency damped goalpost shiver (`pings`), dual expanding metallic rings (`#ffffff` / `#ffd76b`), spinning Post English crescent flare, 12 directional gold/white metallic streak sparks, 40ms hit-stop + shake, 1.45x Post English bite, and upward-inflected metallic zing-ping.',
          soundLabel: 'Play post zing-ping',
          duration: 2.4,
          playSound: ctx => ctx.audio()?.playGoalHit('post', { volume: 1.0, spin: 20, speed: 560 }),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(3, 760, 460);
            ctx.place(4, 760, 140);
            ctx.place(5, 640, 460);
            ctx.place(6, 865, 237, { vx: 580, vy: 0, omega: -20, pace: 580 });
          }
        },
        {
          id: 'net-ripple',
          title: 'Goal Net Mesh Tension & Ripple',
          when: 'Ball or skater hits the exterior/back goal net (`wallType === "net"`) or scores into the net pocket (`goalPocket`).',
          visual: 'Wider team-colored elastic mesh ripple along `NET_RUNS` + contact sparks on exterior hits, and full-pocket mesh billow with white tension highlight on goals.',
          soundLabel: 'Play net thud',
          duration: 2.2,
          playSound: ctx => ctx.audio()?.playGoalHit('net', { volume: 0.9 }),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(0, 92, 292, { vx: -540, vy: -210 });
            ctx.place(3, 908, 308, { vx: 540, vy: 210 });
            ctx.place(6, 500, 300);
          }
        },
        {
          id: 'fireball-burn',
          title: 'Ball Heat Stages, Ignition Burst, Ice Burn & Meteor Bank',
          when: 'Ball pace crosses 540 (orange) -> 720 (red + sparks) -> 800 (red-hot) -> 840+ on fire (`sparkBall` ignition burst, `burnIce`, `r.meteor` board scorch).',
          visual: 'Mid-flight ignition shockwave rings, flash, ember streaks, ignition whoof & bulbous heat devil at 60 heat ticks; glowing fireball with swirling GPU scene refraction that visibly bends skaters, the fireball, flames, sparks, trails and rink beneath it (pauses with freeze frames; Canvas 2D local-crop fallback), additive flames, warm umber-to-soot ice burn ribbon matching wall scorch colors, with feathered sides and rounded, fading ends, and Meteor Bank impact hotspot glow, rink-clipped circular black ash char poof, expanding scene-refraction eddies & tangential ember streaks.',
          soundLabel: 'Play fire sizzle (1.5s)',
          variants: [
            { id: 'fire', label: 'Full Fireball + Meteor Bank' },
            { id: 'ignite', label: 'Mid-Flight Ignition (60 Ticks)' },
            { id: 'redhot', label: 'Red-Hot (820 px/s)' },
            { id: 'red', label: 'Red + Sparks (750 px/s)' },
            { id: 'orange', label: 'Orange Glow (600 px/s)' }
          ],
          duration: 2.8,
          playSound: ctx => ctx.playTimedSizzle(1.5),
          run: (ctx, variant = 'fire') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(3, 720, 470);
            ctx.place(4, 520, 470);
            ctx.place(5, 320, 470);
            if (variant === 'orange') {
              ctx.place(6, 180, 260, { vx: 590, vy: 90, pace: 600 });
            } else if (variant === 'red') {
              ctx.place(6, 180, 260, { vx: 735, vy: 110, pace: 750 });
            } else if (variant === 'redhot') {
              ctx.place(6, 180, 260, { vx: 805, vy: 120, pace: 820 });
            } else if (variant === 'ignite') {
              ctx.place(6, 220, 290, {
                vx: 920, vy: -120, omega: 12,
                onFire: false, fireTicks: 48, pace: 930, strikerPower: 1.35, strikerTeam: 0, strikerSlot: 0
              });
            } else {
              ctx.place(6, 290, 150, {
                vx: 820, vy: -480, omega: 10,
                onFire: true, fireTicks: 60, pace: 980, strikerPower: 1.35, strikerTeam: 0, strikerSlot: 0
              });
            }
          }
        },
        {
          id: 'fireball-plow',
          title: 'Flaming Ball Impacts: Warp, Heat Devil, Plow & Hot Shot',
          when: 'Flaming ball strikes a skater, boards, or defender (`HIT_STOP.fire = 35ms`, `fx.fireWarp`, `fx.ballWarpFlare`, `plow = true`, `HOT_DRIVE`, `playFireImpact`).',
          visual: '35ms minor hit-stop on ubu contact, damped squash-and-stretch warp, subtle `0.20` ambient heat-devil shimmer while cruising that flares to `0.95` peak refraction with subtle RGB chromatic dispersion on impacts, multi-pass emissive bloom, 15-particle flame scatter, and surging resonant flaming woosh.',
          soundLabel: 'Play flaming woosh',
          variants: [
            { id: 'plow', label: 'Overpower Defender (Plow)' },
            { id: 'hotshot', label: 'Teammate Trap + Hot Shot' }
          ],
          duration: 2.6,
          playSound: ctx => {
            ctx.audio()?.playFireImpact?.({ volume: 0.9 });
            ctx.audio()?.playBallHit({ volume: 0.9, snap: false });
          },
          run: (ctx, variant = 'plow') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(4, 780, 470);
            ctx.place(5, 780, 130);
            if (variant === 'hotshot') {
              // Loaded burning ball trapped near rest by teammate 1, while teammate 0 drives in to fire a Hot Shot!
              ctx.place(1, 470, 250);
              ctx.place(6, 500, 300, {
                vx: 15, vy: 0, onFire: true, fireTicks: 60, pace: 960, strikerPower: 1.3, strikerTeam: 0, strikerSlot: 1
              });
              ctx.place(0, 360, 300, { vx: 420, vy: 0 });
              ctx.place(3, 820, 460);
            } else {
              ctx.boostStats(3, { stability: 0, mass: 0 });
              ctx.place(3, 520, 300, { vx: 0, vy: 8 });
              ctx.place(6, 260, 294, {
                vx: 980, vy: 0, onFire: true, fireTicks: 60, pace: 980, strikerPower: 1.5, strikerTeam: 0, strikerSlot: 0
              });
            }
          }
        }
      ]
    },
    {
      id: 'saves',
      title: '5. Saves',
      summary: 'Two-beat Guard stance & shield flex, goal-line saves (`Save!` & `Save...`), metallic Iron Saves, and friendly Traps.',
      items: [
        {
          id: 'guard-two-beat',
          title: 'Two-Beat Guard: Skate-Edge Plant & Scaled Shield Flex',
          when: 'Choosing Guard in planning (`playGuardToggle`) and taking a light poke vs. hard shot/check in play (`guardFlexes`, `playGuardHit`).',
          visual: 'Beat 1 plants two close-set skate edges (`chak-set` + shield lock pulse); Beat 2 dents the struck side of the Guard ring inward with heel-ice puffs and a low knock scaled from soft poke to heavy drive.',
          soundLabel: 'Play plant + hit',
          variants: [
            { id: 'plant-then-save', label: 'Full 2-Beat: Plant -> Heavy Stop' },
            { id: 'heavy-stop', label: 'Heavy Drive (Deep Flex & Knock)' },
            { id: 'light-poke', label: 'Weak Poke (Subtle Flex & Murmur)' }
          ],
          duration: 2.5,
          playSound: (ctx, variant = 'plant-then-save') => {
            if (variant === 'light-poke') {
              ctx.audio()?.playGuardHit?.({ strength: 0.14, graze: 0.25, volume: 0.5, x: 320, y: 300 });
            } else if (variant === 'heavy-stop') {
              ctx.audio()?.playGuardHit?.({ strength: 0.94, graze: 0.04, volume: 0.96, x: 320, y: 300 });
            } else {
              ctx.audio()?.playGuardToggle?.(true, { x: 320, y: 300 });
              setTimeout(() => ctx.audio()?.playGuardHit?.({ strength: 0.92, graze: 0.04, volume: 0.95, x: 320, y: 300 }), 380);
            }
          },
          run: (ctx, variant = 'plant-then-save') => {
            if (variant === 'plant-then-save') {
              ctx.resetStage({ phase: 'plan', mode: 'standard' });
              ctx.boostStats(0, { stability: 220, mass: 210 });
              ctx.place(0, 310, 300);
              ctx.place(1, 210, 140);
              ctx.place(2, 210, 460);
              ctx.place(3, 610, 300);
              ctx.place(6, 520, 300);
              ctx.plans[0] = { angle: 0, power: 0.7, spin: 0, guard: false };
              ctx.plans[3] = { angle: Math.PI, power: 0.92, spin: 0, guard: false };
              ctx.presenter.dirtyPrediction();
              let planted = false, launched = false;
              ctx.setPlanDriver(t => {
                if (!planted && t >= 0.28) {
                  planted = true;
                  ctx.plans[0] = { ...ctx.plans[0], guard: true };
                  ctx.presenter.triggerGuardToggle?.(0, true);
                  ctx.presenter.dirtyPrediction();
                } else if (!launched && t >= 0.82) {
                  launched = true;
                  ctx.setPlanDriver(null);
                  ctx.launchPlans(ctx.plans);
                }
              });
              return;
            }
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.boostStats(0, { stability: 220, mass: 210 });
            ctx.bodies[0].guarding = true;
            ctx.P.syncEffectiveStats(ctx.bodies[0]);
            ctx.place(0, 320, 300);
            ctx.place(1, 210, 140);
            ctx.place(2, 210, 460);
            if (variant === 'light-poke') {
              ctx.place(6, 405, 306, { vx: -155, vy: -12, strikerTeam: 1 });
            } else {
              ctx.place(6, 515, 300, { vx: -680, vy: 0, pace: 680, strikerTeam: 1 });
            }
          }
        },
        {
          id: 'standard-save',
          title: 'Goal-Line Save (`"Save!"` & `"Save..."`)',
          when: 'Skater intercepts a shot within 300 px of own goal that was heading in within 1s (`creditSave`, `playSave`).',
          visual: 'Crisp metallic blade shing/tink (gentler tink on `"Save..."`), pop-in `"Save!"` callout, 60-100ms hit-stop + shake, and meter glint.',
          soundLabel: 'Play save shing',
          variants: [
            { id: 'save', label: 'Save! (Opponent Shot)' },
            { id: 'own', label: 'Save... (Own-Team Deflection)' }
          ],
          duration: 2.4,
          playSound: (ctx, variant = 'save') => {
            ctx.audio()?.playSave?.({ own: variant === 'own' });
          },
          run: (ctx, variant = 'save') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.bodies[0].meter = 35;
            ctx.syncMeters();
            ctx.place(0, 125, 255, { vx: 0, vy: 280 });
            ctx.place(1, 320, 120);
            ctx.place(2, 320, 480);
            ctx.place(6, 290, 300, { vx: -520, vy: 0, pace: 520, strikerTeam: variant === 'own' ? 0 : 1 });
            ctx.play.credit[variant === 'own' ? 1 : 3] = 1;
            ctx.play.last = variant === 'own' ? 1 : 3;
          }
        },
        {
          id: 'iron-save',
          title: 'Iron Save (`"Big save!"`) & Friendly Trap (`"Trap!"`)',
          when: 'Guarding skater resists a burning fireball (`R >= E`, `iron = true`).',
          visual: 'Metallic iron shield (`#c3ccd6` / `#6b7785`), quenched fireball dead at feet, 24-particle `steamRing`, 85 px `#e3faff` shockwave, 150ms hit-stop + shake.',
          soundLabel: 'Play iron save',
          variants: [
            { id: 'opponent', label: 'Big save! (Opponent Fireball)' },
            { id: 'friendly', label: 'Trap! (Teammate Fireball)' }
          ],
          duration: 2.6,
          playSound: ctx => ctx.audio()?.playIronSave({ volume: 1.0 }),
          run: (ctx, variant = 'opponent') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.boostStats(0, { stability: 220, mass: 220 });
            ctx.bodies[0].meter = 45;
            ctx.bodies[0].guarding = true;
            ctx.P.syncEffectiveStats(ctx.bodies[0]);
            ctx.place(0, 145, 300);
            ctx.place(3, 195, 245); // Nearby skater gets repelled by the 85px Iron Save shockwave!
            ctx.syncMeters();
            const own = variant === 'friendly';
            ctx.place(6, 330, 300, {
              vx: -920, vy: 0, onFire: true, fireTicks: 60, pace: 920,
              strikerPower: 1.0, strikerTeam: own ? 0 : 1, strikerSlot: own ? 1 : 3
            });
            ctx.play.credit[own ? 1 : 3] = 1;
            ctx.play.last = own ? 1 : 3;
          }
        }
      ]
    },
    {
      id: 'supers',
      title: '6. Supers',
      summary: 'HUD super meter gain/full animations, Ready vs. Armed conic-ring auras, and all 8 canonical super abilities.',
      items: [
        {
          id: 'super-auras',
          title: 'Super Meter Glint/Shimmer & Ready vs. Armed Auras',
          when: 'Meter gains charge (`setMeterFill` `.gain`) to 100% (`.full` shimmer) and a super becomes Ready (`level 1`) or Armed (`level 2`).',
          visual: 'HUD meter gain flash + full rainbow shimmer; Ready single conic sweep vs. Armed dual counter-rotating rings, radial halo & 2 orbiting sparks.',
          variants: [
            { id: 'selected', label: 'Selected Super Picker' },
            { id: 'all-themes', label: 'Showcase 6 Super Themes' }
          ],
          duration: 3.2,
          run: (ctx, variant = 'selected') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            const chosenId = ctx.getSelectedSuperId();
            for (let i = 0; i < 6; i++) {
              const id = variant === 'all-themes' ? i : chosenId;
              ctx.equipSuper(i, id);
              ctx.bodies[i].meter = 100;
              ctx.bodies[i].superArm = i % 2 === 1; // Left/even = Ready (level 1), odd = Armed (level 2)
            }
            ctx.place(0, 260, 190);
            ctx.place(1, 260, 410);
            ctx.place(2, 430, 300);
            ctx.place(3, 590, 300);
            ctx.place(4, 740, 190);
            ctx.place(5, 740, 410);
            ctx.place(6, 500, 120);
            // Animate HUD super meter bars from 40% -> 75% -> 100% so `.gain` glint and `.full` shimmer both show
            ctx.bodies[0].meter = 40; ctx.bodies[1].meter = 70; ctx.bodies[2].meter = 100;
            ctx.syncMeters();
            ctx.after(0.35, () => { ctx.bodies[0].meter = 75; ctx.bodies[1].meter = 100; ctx.syncMeters(); });
            ctx.after(0.75, () => { ctx.bodies[0].meter = 100; ctx.syncMeters(); });
          }
        },
        {
          id: 'super-stalwart',
          title: '00 · Stalwart (Steel Anchor & Impact Shockwave)',
          when: 'Launching and sliding with Stalwart active (`launch`, `markIce`) and absorbing checks or shots (`impact`).',
          visual: 'Gold & indigo aura (`#ffd166` / `#4f5fc2`), 3x braking slide leaving continuous skidmarks everywhere while live, golden burst + 36 px shockwave on impact.',
          soundLabel: 'Play steel clank',
          variants: [
            { id: 'both', label: 'Launch + Impact Scenario' },
            { id: 'impact-sfx', label: 'Sound: Impact Clank' }
          ],
          duration: 2.6,
          playSound: (ctx, variant) => ctx.audio()?.playSuper('stalwart', variant === 'impact-sfx' ? 'impact' : 'launch'),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.equipSuper(0, 0);
            ctx.bodies[0].meter = 100;
            ctx.place(0, 260, 300);
            ctx.place(3, 450, 270);
            ctx.place(6, 490, 325);
            const plans = ctx.idlePlans();
            plans[0] = { angle: 0, power: 0.55, spin: 0, superArm: true };
            plans[3] = { angle: Math.PI - 0.18, power: 1.0, spin: 0 };
            ctx.launchPlans(plans);
            ctx.bodies[6].vx = -640; ctx.bodies[6].vy = -65;
          }
        },
        {
          id: 'super-knockout',
          title: '01 · Knockout (Heavyweight POW, Directional Shock-Cone & Stunned State)',
          when: 'Touching an opposing skater while Knockout is active (`handleSuper("knockout", "impact")`).',
          visual: 'Crimson & pink conic shader aura (`#ee2b47` / `#ff7197`) with multi-pass bloom, heavyweight arcade POW punch, damped squash-and-stretch KO warp + radial space-warp wavefront with RGB chromatic dispersion, directional crimson shock-cone & blow-through streak shards behind the target, and target dimmed with `💫` stun stars.',
          soundLabel: 'Play knockout POW',
          duration: 2.5,
          playSound: ctx => ctx.audio()?.playSuper('knockout', 'impact'),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.equipSuper(0, 1);
            ctx.bodies[0].meter = 100;
            ctx.place(0, 310, 300);
            ctx.place(3, 490, 300);
            ctx.place(6, 500, 130);
            const plans = ctx.idlePlans();
            plans[0] = { angle: 0, power: 0.95, spin: 0, superArm: true };
            plans[3] = { angle: Math.PI, power: 0.35, spin: 0 };
            ctx.launchPlans(plans);
          }
        },
        {
          id: 'super-sticky',
          title: '02 · Sticky (Goop Splat Grab, Release Burst & Emerald Tether)',
          when: 'Grabbing the ball (`handleSuper("sticky", "impact")`), holding (`drawStickyTether`), and releasing the ball (`checkStickyRelease`).',
          visual: 'Emerald aura (`#42c66b`), goop-splat/jelly bubble/streak particles and shockwave on both ball grab and release, and pulsing tangent energy bridge (`#44dd66` / `#d9ffe3`).',
          soundLabel: 'Play goop splat',
          duration: 2.8,
          playSound: ctx => ctx.audio()?.playSuper('sticky', 'impact'),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.equipSuper(0, 2);
            ctx.bodies[0].meter = 100;
            ctx.place(0, 260, 360);
            ctx.place(6, 380, 315, { vx: -180, vy: 40 });
            const plans = ctx.idlePlans();
            plans[0] = { angle: -0.32, power: 0.95, spin: 0.75, superArm: true };
            ctx.launchPlans(plans);
            ctx.bodies[6].vx = -180; ctx.bodies[6].vy = 40;
          }
        },
        {
          id: 'super-cannonball',
          title: '03 · Cannonball (Explosive Blast, Side Fire Jets & Ground Scorch)',
          when: 'Striking the ball with Cannonball active (`handleSuper("cannonball", "impact")`).',
          visual: 'Fiery red/orange conic shader aura with multi-pass bloom; on ball impact, a quick fanned burst of fireball `flame` jets ejecting forward at ±45° toward the ball, light-grey gunpowder smoke puffs shooting forward along the ball direction at ~50% ball speed, charred ground scorch + glowing embers (`fx.burns`), `#ff634d` blast burst + 48 px shockwave, radial space-warp wavefront, `ballFlare = 1` + `ballWarpFlare = 1` heat-devil flare, instant fireball ignition, and hit-stop + shake.',
          soundLabel: 'Play cannonball boom',
          duration: 2.6,
          playSound: ctx => ctx.audio()?.playSuper('cannonball', 'impact'),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.equipSuper(0, 3);
            ctx.bodies[0].meter = 100;
            ctx.place(0, 280, 320);
            ctx.place(6, 380, 300);
            ctx.place(3, 760, 140);
            ctx.place(4, 760, 460);
            ctx.place(5, 620, 470);
            const plans = ctx.idlePlans();
            plans[0] = { angle: -0.22, power: 0.92, spin: 0.4, superArm: true };
            ctx.launchPlans(plans);
          }
        },
        {
          id: 'super-magnet',
          title: '04 · Magnet (Tractor Beam & Flowing Polarity Chevrons)',
          when: 'Ball enters 190 px of an active Magnet skater (`handleSuper("magnet", "pull")`).',
          visual: 'Blue & red polarity aura (`#3388ff` / `#ff3344`), dual bowed field lines, animated inward-flowing polarity chevrons (`#7ec8ff` / `#ff6b7a`), and proximity-pitched tractor-beam hum.',
          soundLabel: 'Play magnet beam',
          duration: 2.8,
          playSound: ctx => ctx.audio()?.playSuper('magnet', 'pull', { closeness: 0.8 }),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.equipSuper(0, 4);
            ctx.bodies[0].meter = 100;
            ctx.place(0, 360, 330);
            ctx.place(6, 340, 195);
            const plans = ctx.idlePlans();
            plans[0] = { angle: 0, power: 0.6, spin: 0, superArm: true };
            ctx.launchPlans(plans);
            ctx.bodies[6].vx = 430; ctx.bodies[6].vy = -25;
          }
        },
        {
          id: 'super-colossus',
          title: '05 · Colossus (Cracked Ice Dent, Growth Lines & Titan Expansion)',
          when: 'Launching with Colossus armed (`handleSuper("colossus", "launch")`), swelling across 40 expansion ticks, and hitting full size (`colossusProgress >= 1`).',
          visual: 'Golden titan aura (`#ffe043` / `#c8961e`), golden growth-ring burst and radial growth lines while swelling to 1.5x max size/mass, slamming down a big circular ice dent with branching fracture cracks fading like skidmarks (`fx.skids`) and ice-shard spray upon reaching full size, and sky-splitting thunderclap.',
          soundLabel: 'Play colossus thunder',
          duration: 2.7,
          playSound: ctx => ctx.audio()?.playSuper('colossus', 'launch'),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.equipSuper(0, 5);
            ctx.bodies[0].meter = 100;
            ctx.place(0, 260, 300);
            ctx.place(3, 470, 275);
            ctx.place(4, 510, 335);
            ctx.place(6, 620, 300);
            const plans = ctx.idlePlans();
            plans[0] = { angle: 0, power: 1.0, spin: 0, superArm: true };
            ctx.launchPlans(plans);
          }
        },
        {
          id: 'super-shockwave',
          title: '06 · Shockwave (Dramatic Blast & Repulsion Forcefield Rings)',
          when: 'Opponent enters 170 px of an active Shockwave skater (`handleShockwave`), followed by active repulsion (`b.shockwaveFired`).',
          visual: 'Charged conic shader aura before trigger; dramatic 3-ring sonic blast with radial space-warp wavefront, subtle RGB chromatic dispersion, multi-pass emissive bloom, core flash, 26 radial streak shards & screen shake on trigger; then pulsing forcefield rings that continuously grow and fade while repelling opponents.',
          soundLabel: 'Play shockwave pulse',
          duration: 2.6,
          playSound: ctx => ctx.audio()?.playSuper('shockwave', 'impact'),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.equipSuper(0, 6);
            ctx.bodies[0].meter = 100;
            ctx.place(0, 320, 300);
            ctx.place(3, 540, 255);
            ctx.place(4, 555, 345);
            ctx.place(5, 590, 300);
            ctx.place(6, 500, 120);
            const plans = ctx.idlePlans();
            plans[0] = { angle: 0, power: 0.9, spin: 0, superArm: true };
            ctx.launchPlans(plans);
          }
        },
        {
          id: 'super-ghost',
          title: '07 · Ghost (Translucent Phase Shift & Ectoplasmic Pass-Through)',
          when: 'Launching with Ghost armed (`handleSuper("ghost", "launch")`) and phasing through opposing skaters (`playSuper("ghost", "phase")`).',
          visual: 'Cyan & alabaster conic shader aura (`#33e0ff` / `#f8f6f2`), 45%-opacity body skating straight through blockers, and crisp geometric concentric cyan phase ripples + radial refraction with RGB chromatic split and airy shimmer wisp as the Ghost passes through each defender.',
          soundLabel: 'Play ghost shimmer',
          variants: [
            { id: 'launch', label: 'Phase Through Blockers' },
            { id: 'phase-sfx', label: 'Sound: Pass-Through Wisp' }
          ],
          duration: 2.6,
          playSound: (ctx, variant) => ctx.audio()?.playSuper('ghost', variant === 'phase-sfx' ? 'phase' : 'launch'),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.equipSuper(0, 7);
            ctx.bodies[0].meter = 100;
            ctx.place(0, 250, 300);
            ctx.place(3, 390, 300);
            ctx.place(4, 465, 300);
            ctx.place(6, 560, 300);
            const plans = ctx.idlePlans();
            plans[0] = { angle: 0, power: 0.95, spin: 0, superArm: true };
            ctx.launchPlans(plans);
          }
        }
      ]
    },
    {
      id: 'fouls',
      title: '7. Fouls & Cards',
      summary: 'Goal Camping & Corner Stalling boardside warnings, predicted-clear green checks, lit zone inspectors, and Yellow Cards.',
      items: [
        {
          id: 'foul-camping-warning',
          title: 'Goal Camping Warning, Green Check & Zone Inspector',
          when: 'Turn ends with more defenders in their crease than allowed (`fouls.crease`, `drawFouls`, `drawFoulFocus`).',
          visual: 'Boardside `Goal Camping` alert triangle, flashing offender alerts, predicted-clear green check (`drawCheck`), scorebug tab, and amber Crease/Attack Zone overlay.',
          soundLabel: 'Play warning alert',
          variants: [
            { id: 'warn', label: 'Standing Warning' },
            { id: 'clear', label: 'Predicted Clear (Green Check)' },
            { id: 'inspect', label: 'Lit Zone Inspector' }
          ],
          duration: 3.2,
          playSound: ctx => ctx.audio()?.playFoul('warning'),
          run: (ctx, variant = 'warn') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.place(0, 95, 275);
            ctx.place(1, 102, 330);
            ctx.place(2, 340, 420);
            ctx.fouls.crease[0] = true;
            if (variant === 'clear') {
              ctx.plans[0] = { angle: 0, power: 0.75, spin: 0, guard: false };
            }
            ctx.presenter.dirtyPrediction();
            ctx.bugTab('Goal camping · Home', { team: 0 });
            ctx.audio()?.playFoul('warning');
            if (variant === 'inspect') ctx.openFoulInfo({ kind: 'crease', team: 0 });
          }
        },
        {
          id: 'foul-corner-warning',
          title: 'Corner Stalling Warning & Lit Corner Inspector',
          when: 'Ball finishes 2 consecutive turns in the same corner (`stalling()`, `drawFouls`).',
          visual: 'Boardside `Corner Stalling` warning, flashing alerts on the majority team in the corner, predicted-clear green check, and `100x100` amber corner highlight.',
          soundLabel: 'Play warning alert',
          variants: [
            { id: 'warn', label: 'Standing Warning' },
            { id: 'clear', label: 'Predicted Clear (Green Check)' },
            { id: 'inspect', label: 'Lit Corner Inspector' }
          ],
          duration: 3.2,
          playSound: ctx => ctx.audio()?.playFoul('warning'),
          run: (ctx, variant = 'warn') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.place(6, 118, 108);
            ctx.place(0, 138, 132);
            ctx.place(1, 165, 112);
            ctx.place(3, 150, 162);
            ctx.fouls.corner = 0;
            ctx.fouls.cornerTurns = ctx.ububallMatch.FOULS.stallTurns;
            if (variant === 'clear') {
              ctx.plans[0] = { angle: -0.35, power: 0.9, spin: 0, guard: false };
              ctx.place(0, 92, 120);
            }
            ctx.presenter.dirtyPrediction();
            ctx.bugTab('Corner stalling');
            ctx.audio()?.playFoul('warning');
            if (variant === 'inspect') ctx.openFoulInfo({ kind: 'corner' });
          }
        },
        {
          id: 'foul-yellow-card',
          title: 'Yellow Card Penalty, Trail Erase & Referee Whistle',
          when: 'Standing Goal Camping or Corner Stalling warning is not cleared by end of turn (`callFouls`).',
          visual: 'Offenders teleport to spawn (discontinuous trails erased), fade to 30% opacity with tilted `#ffd60a` card badge, `"Yellow card"` popup, and `"Power play"` scorebug tab.',
          soundLabel: 'Play referee whistle',
          variants: [
            { id: 'crease-card', label: 'Crease Yellow Card + Power Play' },
            { id: 'corner-card', label: 'Corner Card + Center Ball Reset' }
          ],
          duration: 3.0,
          playSound: ctx => ctx.audio()?.playFoul('card'),
          run: (ctx, variant = 'crease-card') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            if (variant === 'corner-card') {
              ctx.place(6, 115, 105);
              ctx.place(0, 135, 125);
              ctx.place(1, 155, 115);
              ctx.place(3, 148, 158);
              ctx.fouls.corner = 0;
              ctx.fouls.cornerTurns = ctx.ububallMatch.FOULS.stallTurns;
            } else {
              ctx.place(0, 95, 275);
              ctx.place(1, 100, 330);
              ctx.fouls.crease[0] = true;
            }
            const before = ctx.presenter.trailPositions();
            ctx.ububallMatch.finishTurn(ctx.P, ctx.bodies, ctx.stats, [0, 0], null, 'standard', {}, ctx.fouls);
            ctx.presenter.clearDiscontinuousTrails(before);
            for (const i of ctx.fouls.cards) ctx.presenter.popup(ctx.bodies[i], 'Yellow card');
            if (ctx.fouls.faceoff) ctx.bugTab('Corner reset');
            ctx.bugTab(`${ctx.fouls.cards.length} yellow cards · Home`, { team: 0 });
            ctx.bugTab('Power play · Away', { team: 1, colour: true });
            ctx.syncMeters();
            ctx.audio()?.playFoul('card');
          }
        }
      ]
    },
    {
      id: 'goals',
      title: '8. Goals & Celebrations',
      summary: 'Goal light sweeps, peony & ring fireworks with crackle, all Goal Call banners, burning nets, 2-bar DNA goal anthems (band, drums, stage, and 1/32 signature drops), and slow-mo replay.',
      items: [
        {
          id: 'goal-celebration',
          title: 'Goal Light Sweep, Scorer Spotlight, Fireworks & Fanfare',
          when: 'Ball crosses a goal line (`celebrate`, `drawGoalSweep`, `drawGoalCall`, `playFanfare`, `playFirework`).',
          visual: '200ms hit-stop + double shake, full-pocket goal net mesh billow, sweeping light band with subtle arena dim & radial scorer spotlight, 9 comet-tailed peony/ring firework shells with core flashes, glowing star tails, strobe micro-sparks & crisp pyrotechnic crackles, scorer double-ring & portrait call.',
          soundLabel: 'Play goal fanfare',
          variants: GOAL_CALL_VARIANTS,
          duration: 4.5,
          playSound: ctx => ctx.playSampleFanfare(false),
          run: (ctx, variant = 'GOAL') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            const isOwn = variant === 'OWN GOAL';
            ctx.place(1, 680, 210);
            ctx.place(0, 790, 305);
            ctx.place(3, 860, 150);
            ctx.place(4, 860, 450);
            ctx.place(6, 885, 300, { vx: 560, vy: 0, pace: 560, strikerTeam: isOwn ? 1 : 0, strikerSlot: 0 });
            ctx.play.credit[isOwn ? 3 : 0] = 1;
            ctx.play.last = isOwn ? 3 : 0;
            ctx.play.assist[0] = isOwn ? null : 1;
            ctx.setForcedGoalLabel(variant);
          }
        },
        {
          id: 'burning-net-goal',
          title: 'Fireball Goal & Burning Net (`lightNet` / `burnNet`)',
          when: 'Scoring while the ball is on fire (`ballOnFire() === true` on goal).',
          visual: 'Entire goal net catches fire (`burnNet`) with the fireball\'s additive flames and hot ember sparks (`#ffb347` / `#fff1c1`) evenly distributed across the full net depth and height alongside `"FIREBALL!"` call and fireworks.',
          soundLabel: 'Play sizzle + fanfare',
          duration: 4.5,
          playSound: ctx => {
            ctx.playTimedSizzle(2.4);
            ctx.playSampleFanfare(false);
          },
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(0, 740, 300);
            ctx.place(3, 840, 140);
            ctx.place(4, 840, 460);
            ctx.place(6, 830, 300, {
              vx: 960, vy: 0, onFire: true, fireTicks: 60, pace: 960, strikerPower: 1.35, strikerTeam: 0, strikerSlot: 0
            });
            ctx.play.credit[0] = 1;
            ctx.play.last = 0;
            ctx.setForcedGoalLabel('FIREBALL!');
          }
        },
        {
          id: 'goal-fireworks',
          title: 'Goal Fireworks & Aerial Shell Pops',
          when: 'Post-goal firework shells ascend with ember trails and reach fuse zero (`explodeShell`, `crackle`, `playFirework`).',
          visual: 'Comet-tailed shells burst with bright core flashes into dual-layer Peony or Ring + Pistil stars with glowing tails and secondary strobe crackle sparks, paired with mortar pops and discrete impulse star crackles.',
          soundLabel: 'Play firework pop',
          variants: [
            { id: 'peony', label: 'Peony Volley (Home)' },
            { id: 'ring', label: 'Ring Shell Volley (Away)' }
          ],
          duration: 3.6,
          playSound: (ctx, variant = 'peony') => ctx.audio()?.playFirework?.({ ring: variant === 'ring', volume: 0.75 }),
          run: (ctx, variant = 'peony') => {
            ctx.resetStage({ phase: 'goal', mode: 'standard' });
            const team = variant === 'ring' ? 1 : 0;
            ctx.presenter.celebrate(team, ctx.bodies[6], variant === 'ring' ? 'SNIPE!' : 'GOAL', ctx.bodies[team ? 3 : 0]);
          }
        },
        {
          id: 'goal-replay-voice',
          title: 'Goal Replay Slow-Motion & Ubu Signature Voice',
          when: 'Post-goal instant replay (`ububallMatch.replaySpeed` ramp) and Ubu voice call (`playVoice`).',
          visual: 'Re-simulates the scoring play ramping smoothly into 0.25x-0.5x slow motion with top `REPLAY · SLOW MOTION` watermark.',
          soundLabel: 'Play Ubu voice',
          duration: 4.2,
          playSound: ctx => ctx.audio()?.playVoice(ctx.voice()),
          run: ctx => {
            ctx.startGoalReplayDemo();
            ctx.audio()?.playVoice(ctx.voice());
          }
        }
      ]
    },
    {
      id: 'stage',
      title: '9. Stage & Mint',
      summary: 'Persistent rink cast scatter & return, Choose Team kickoff arrival, and Ubu Mint spotlight reveal & scamper.',
      items: [
        {
          id: 'stage-cast-scatter',
          title: 'Cast Scatter & Return (`castTo`)',
          when: 'Entering or leaving `rules`, `team`, `mint`, or `collection` (`castTo(true)` / `castTo(false)`).',
          visual: 'Display-only skater & ball cast flies straight out from centre ice `(500, 300)` (`820 px` quadratic ease, `50ms` per-body stagger, `±5 rad` spin) without altering simulation bodies, then skates back to exact positions on return.',
          variants: [
            { id: 'scatter-return', label: 'Scatter Out + Return' },
            { id: 'scatter', label: 'Scatter Off Ice' },
            { id: 'return', label: 'Return to Ice' }
          ],
          duration: 2.4,
          run: (ctx, variant = 'scatter-return') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.place(0, 220, 210);
            ctx.place(1, 355, 165);
            ctx.place(2, 340, 420);
            ctx.place(3, 645, 185);
            ctx.place(4, 670, 415);
            ctx.place(5, 805, 305);
            ctx.place(6, 515, 285);
            if (variant === 'return') {
              ctx.runStageCast?.('return');
            } else if (variant === 'scatter') {
              ctx.runStageCast?.('scatter');
            } else {
              ctx.runStageCast?.('scatter');
              ctx.after(0.95, () => ctx.runStageCast?.('return'));
            }
          }
        },
        {
          id: 'stage-lineup-arrival',
          title: 'Choose Team Lineup Skate-In & Skate-Out (`skateLineup`)',
          when: 'Opening or closing the docked Choose Team / Rules panel (`openSheet`, `skateLineup(true/false)`).',
          visual: 'Active match or demo cast scatters off the ice while your three home ubus (`Back`, `Top`, `Bottom`) glide in from the home goal (`-45cqw → 0`, `480ms` after `240ms` lead) inside on-ice kickoff position cards; closing skates the lineup back out (`260ms`) as the cast returns.',
          variants: [
            { id: 'arrive', label: 'Scatter + Lineup Skate-In' },
            { id: 'depart', label: 'Lineup Skate-Out + Cast Return' }
          ],
          duration: 2.6,
          run: (ctx, variant = 'arrive') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.runStageLineup?.(variant);
          }
        },
        {
          id: 'stage-mint-scamper',
          title: 'Ubu Mint Spotlights, Charged & Special Packs, Reveal & Scamper (`mintLights`, `playPack`)',
          when: 'Dealing Regular, Material (`special`), and Charged (`charge` 1–5) packs in Ubu Mint, revealing silhouetted ubus, and pressing `Done` (`finishPackWithScamper`, `playPack`).',
          visual: 'Charged Packs (`charge` 1–5 top-decile Ability ubus) leak pressurized Volt (`#0066FF`) seam/crack light, electric sparks, micro-arcs, and Volt-tinted spotlights; silhouetted Charged ubus crackle with Volt arcs while Material ubus twinkle with pearlescent sparkles, and first-open cards burst around the ubu coin and call out the Ability / Rarity score ledges before scampering off.',
          soundLabel: 'Play pack sound',
          variants: [
            { id: 'scamper-5', label: '5-Ubu Reveal + Scamper' },
            { id: 'scamper-3', label: '3-Ubu Starter Scamper' },
            { id: 'special-reveal', label: 'Charged + Material Silhouettes & Reveal' },
            { id: 'charge-1', label: 'Charged Pack (Stage 1)' },
            { id: 'charge-3', label: 'Charged Pack (Stage 3)' },
            { id: 'charge-5', label: 'Charged Pack (Stage 5)' },
            { id: 'deal', label: 'Deal 3 Packs' },
            { id: 'pick', label: 'Pick Pack to Centre' },
            { id: 'crack', label: 'Egg Crack (3 Taps)' }
          ],
          duration: 3.1,
          playSound: (ctx, variant = 'scamper-5') => {
            const a = ctx.audio();
            if (!a?.playPack) return;
            if (variant === 'deal') a.playPack('deal');
            else if (variant === 'pick') a.playPack('pick');
            else if (variant === 'crack') a.playPack('crack', { stage: 3 });
            else if (variant?.startsWith('charge-')) a.playPack('charge', { stage: Number(variant.slice(7)) || 3 });
            else if (variant === 'special-reveal') a.playPack('reveal', { charged: true, material: true });
            else a.playPack('scamper', { count: variant === 'scamper-3' ? 3 : 5 });
          },
          run: (ctx, variant = 'scamper-5') => {
            ctx.resetStage({ phase: 'plan', mode: 'standard' });
            ctx.runStageMint?.(variant);
          }
        }
      ]
    }
  ];

  // Browser workbench runtime
  function bootBrowserWorkbench() {
    const doc = root.document;
    if (!doc || !doc.getElementById('effects-app')) return null;

    const $ = id => doc.getElementById(id);
    const P = root.ububallPhysics;
    const ububallMatch = root.ububallMatch;
    const ubu = root.ubu;
    const ubuRender = root.ubuRender;
    const ubuAudio = root.ubuAudio;
    const rarity = root.rarity;

    const stageArea = $('stage-area');
    const rinkWrap = $('rink-wrap');
    const canvas = $('rink');
    const badgeCanvas = doc.createElement('canvas');
    badgeCanvas.className = 'field-badges';
    badgeCanvas.setAttribute('aria-hidden', 'true');
    rinkWrap.append(badgeCanvas);

    const view = {
      canvas,
      ctx: null,
      badgeCanvas,
      badgeCtx: badgeCanvas.getContext('2d'),
      bodies: P.kickoff(),
      entries: [],
      mode: 'standard',
      portrait: false,
      anonymous: false,
      castHidden: false,
      field: null
    };

    const makeTeamEntries = () => {
      const codes = rarity?.starterTeam ? [...rarity.starterTeam(ubu), ...rarity.starterTeam(ubu)] : Array.from({ length: 6 }, () => ubu.toCode(ubu.randomDNA()));
      return codes.slice(0, 6).map((dna, i) => {
        const model = ubu.decode(ubu.fromCode(dna));
        const baseSuper = P.SUPERS[i % P.SUPERS.length];
        return {
          key: 'fx-' + i,
          dna,
          label: model.parts.fullName,
          baseModel: model,
          model,
          equippedSuper: { ...baseSuper, displayName: baseSuper.name, bonusTicks: 0, bonusRefund: 0 }
        };
      });
    };

    view.entries = makeTeamEntries();
    let fx = createEffectsState(view.entries, MATERIAL_STYLES);
    let skaters = [];
    let stats = view.entries.map(e => ({ ...e.model.stats }));
    let plans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, guard: false }));
    let selected = 0;
    let scores = [0, 0];
    let turn = 1;
    let phase = 'plan';
    let elapsed = 0;
    let accumulator = 0;
    let matchTicks = 0;
    let clockMs = performance.now();
    let hitStopUntil = 0;
    let fouls = ububallMatch.newFouls();
    let foulInfo = null;
    let foulInfoKey = '';
    let play = ububallMatch.newPlay();
    let tally = ububallMatch.newTally();
    let scoringPlayer = null;
    let postGoal = null;
    let goalReplay = null;
    let forcedGoalLabel = null;
    let sizzleTimer = null;
    let timedCallbacks = [];
    let castState = null;
    let stageChoreoActive = false;
    let lineupAnim = null;
    let mintSpots = [];
    let mintTargetSpots = [];

    // Sandbox control state
    let paused = false;
    let speedMultiplier = 1;
    let autoLoop = false;
    let forceReducedMotion = false;
    let muted = false;
    let selectedMaterial = 'iridescent';
    let selectedSuperId = 3; // Cannonball default
    let selectedMastery = 1;
    let activeDemo = null;
    let activeVariant = undefined;
    let scenarioElapsed = 0;

    const nativeReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const isReduced = () => forceReducedMotion || nativeReducedMotion.matches;
    const activeAudio = () => (muted ? null : ubuAudio);

    const presenter = createRinkPresenter({
      P,
      ububallMatch,
      ububallReplay: root.ububallReplay,
      getView: () => view,
      getEffects: () => fx,
      getPhase: () => phase,
      getPlans: () => plans,
      getSelected: () => selected,
      getTurn: () => turn,
      getElapsed: () => elapsed,
      getFouls: () => fouls,
      getFoulInfo: () => foulInfo,
      getScoringPlayer: () => scoringPlayer,
      getGoalReplay: () => goalReplay,
      isMoving: () => !paused && (phase === 'play' || Boolean(postGoal) || Boolean(goalReplay)),
      getSkaters: () => skaters,
      getRinkWrap: () => rinkWrap,
      getRenderSize: () => ({
        renderWidth: canvas.clientWidth || 1000,
        renderHeight: canvas.clientHeight || 600,
        visibleRinkHeight: 600
      }),
      isReducedMotion: isReduced,
      clockNow: () => clockMs,
      gameAudio: activeAudio,
      uiScale: () => 1,
      contactMeter: (a, b, spd, passerSlot) => awardContactMeter(a, b, spd, passerSlot),
      setHitStopUntil: until => { hitStopUntil = until; },
      onClearPostGoal: () => { postGoal = null; },
      onAssetLoad: () => draw()
    });

    function rebuildSprites() {
      fx.materialEmitters = createMaterialEmitters(view.entries, MATERIAL_STYLES);
      skaters = mountSkaterSprites($('skaters'), view.entries, ubuRender, () => draw());
      for (let i = 0; i < 3; i++) {
        const label = $(`meter-name-${i}`);
        if (label) label.textContent = view.entries[i].model.parts.fullName;
      }
      updateVoiceReadout();
    }

    function setSkaterMaterial(index, materialKey) {
      const entry = view.entries[index];
      if (!entry) return;
      const base = entry.baseModel;
      const clonedAttrs = structuredClone(base.attributes);
      clonedAttrs.background.texture = materialKey || null;
      // Setting dna: null ensures ubuRender.sprite hashes the updated material attributes.
      entry.model = { ...base, dna: null, attributes: clonedAttrs };
      fx.materialEmitters = createMaterialEmitters(view.entries, MATERIAL_STYLES);
      if (skaters[index]) {
        const single = doc.createElement('div');
        const built = mountSkaterSprites(single, [entry], ubuRender, () => draw())[0];
        skaters[index].replaceWith(built);
        skaters[index] = built;
      }
    }

    function masteryObject(superId, level = selectedMastery) {
      const base = P.SUPERS[superId] || P.SUPERS[0];
      const bonusTicks = level === 4 ? 480 : level === 3 ? 240 : level === 2 ? 120 : 0;
      const bonusRefund = level === 4 ? 20 : level === 3 ? 10 : level === 2 ? 5 : 0;
      const suffix = level === 4 ? ' Master' : level === 3 ? ' III' : level === 2 ? ' II' : '';
      return {
        ...base,
        level,
        bonusTicks,
        bonusRefund,
        displayName: base.name + suffix
      };
    }

    function equipSuper(index, superId, level = selectedMastery) {
      const b = view.bodies[index], entry = view.entries[index];
      if (!b || !entry) return;
      const sObj = masteryObject(superId, level);
      entry.equippedSuper = sObj;
      b.equippedSuper = { id: sObj.id, key: sObj.key, bonusTicks: sObj.bonusTicks, bonusRefund: sObj.bonusRefund, displayName: sObj.displayName };
      b.superBonusTicks = sObj.bonusTicks;
      b.superBonusRefund = sObj.bonusRefund;
    }

    function syncMeters(forceReset = false) {
      for (let i = 0; i < 3; i++) {
        const fill = $(`super-fill-${i}`), pct = $(`super-pct-${i}`);
        const val = Math.min(100, Math.max(0, view.bodies[i]?.meter || 0));
        if (forceReset && fill) fill.dataset.value = '0';
        if (fill) setMeterFill(fill, val);
        if (pct) pct.textContent = Math.floor(val) + '%';
      }
    }

    function awardContactMeter(a, b, speed, passerSlot = -1) {
      if (phase !== 'play' || goalReplay) return;
      const tick = matchTicks + Math.round((elapsed + P.DT) / P.DT);
      const changed = ububallMatch.contactMeter(P, view.bodies, stats, a, b, speed, tick, ububallMatch.rule(view.mode, 'classic'), passerSlot);
      if (changed.length) syncMeters();
    }

    function creditSave(body, own, iron = false) {
      if (iron && body) body.ironGuard = true;
      presenter.popup(body, iron ? (own ? 'Trap!' : 'Big save!') : own ? 'Save...' : 'Save!');
      if (iron) {
        presenter.steamRing(body.x, body.y, body.radius);
        activeAudio()?.playIronSave?.();
      } else {
        activeAudio()?.playSave?.({ own: Boolean(own) });
      }
      if (phase === 'play' && !own && !goalReplay) {
        ububallMatch.gainMeter(P, view.bodies, stats, body, ububallMatch.METER.save, ububallMatch.rule(view.mode, 'classic'));
        syncMeters();
      }
    }

    const liveFx = {
      collide: contact => presenter.handleCollision(contact),
      wall: (body, velocity, wallType, nx, ny, rimmed = false, spinBite = 0, counterScuff = 0) =>
        presenter.handleWall(body, velocity, wallType, nx, ny, rimmed, spinBite, counterScuff),
      shockwave: (source, radius, type = null) =>
        presenter.handleShockwave(source, radius, type),
      super: (key, stage, body, target = null) =>
        presenter.handleSuper(key, stage, body, target),
      launch: (body, idx, kind, preVx, preVy, postVx, postVy, strength) =>
        presenter.handleLaunch(body, idx, kind, preVx, preVy, postVx, postVy, strength)
    };

    // Scorebug & banner helpers
    const bugTabs = [];
    let bugTabTimer = 0;
    function bugTab(text, { team = null, colour = false } = {}) {
      bugTabs.push({ text, team, colour });
      if (!bugTabTimer) nextBugTab();
    }
    function nextBugTab() {
      const tab = $('bug-tab'), next = bugTabs.shift();
      if (!next) { tab.classList.remove('show'); bugTabTimer = 0; return; }
      tab.textContent = next.text;
      tab.dataset.tone = next.colour ? (next.team ? 'away' : 'home') : '';
      const board = tab.parentElement.getBoundingClientRect(), width = tab.offsetWidth || 120;
      const cell = next.team === null ? null : tab.parentElement.querySelector(next.team ? '.bug-away' : '.bug-home')?.getBoundingClientRect();
      const x = cell ? cell.left - board.left + cell.width / 2 : board.width / 2;
      tab.style.left = Math.max(width / 2, Math.min(board.width - width / 2, x)) + 'px';
      tab.style.top = (board.height - 2) + 'px';
      tab.classList.add('show');
      bugTabTimer = setTimeout(() => { tab.classList.remove('show'); bugTabTimer = setTimeout(nextBugTab, 220); }, 2200);
    }

    let bannerTimer = 0;
    function banner(text, ms = 1200, tone = '') {
      const node = $('field-banner');
      clearTimeout(bannerTimer);
      node.textContent = text;
      node.dataset.tone = tone;
      node.style.setProperty('--banner-ms', `${ms}ms`);
      node.classList.remove('show');
      void node.offsetWidth;
      node.classList.add('show');
      bannerTimer = setTimeout(() => node.classList.remove('show'), ms);
    }

    function showModeTags(mode) {
      $('mode-tags').replaceChildren(...ububallMatch.RULES.filter(rule => ububallMatch.rule(mode, rule)).map(rule => {
        const tag = doc.createElement('span');
        tag.className = 'bug-mode';
        tag.dataset.rule = rule;
        tag.title = rule[0].toUpperCase() + rule.slice(1);
        tag.append(Object.assign(doc.createElement('span'), { textContent: tag.title }), Object.assign(doc.createElement('b'), { textContent: rule[0].toUpperCase() }));
        return tag;
      }));
    }

    function syncScorebug() {
      $('home-score').textContent = String(scores[0]);
      $('away-score').textContent = String(scores[1]);
      $('turn-label').textContent = String(turn);
      $('phase').textContent = goalReplay ? 'Replay' : phase === 'plan' ? 'Plan' : phase === 'goal' ? 'Goal' : 'In play';
      $('btn-launch-plan').hidden = phase !== 'plan' || Boolean(goalReplay);
    }

    // Foul explanation overlay (uses real .foul-info markup & styles)
    const foulBox = $('foul-box');
    $('foul-got-it').onclick = () => { foulInfo = null; foulBox.hidden = true; draw(); };
    function openFoulInfo(info) {
      foulInfo = info;
      foulInfoKey = '';
      foulBox.hidden = false;
      updateFoulInfo();
      draw();
    }
    function updateFoulInfo() {
      if (!foulInfo) return;
      if (foulInfo.kind === 'crease' ? !fouls.crease[foulInfo.team] : !presenter.stalling(fouls)) {
        foulInfo = null; foulBox.hidden = true; return;
      }
      const ubus = view.bodies.slice(0, 6);
      let title, lines;
      if (foulInfo.kind === 'corner') {
        const [home, away] = presenter.cornerTeams(fouls).map(list => list.length);
        title = 'Corner stalling';
        lines = [
          { text: `The ball has been in this corner for ${fouls.cornerTurns} turns.` },
          { text: 'Clear it out this turn.', act: true },
          { text: home !== away ? `${home > away ? 'Home' : 'Away'} would be yellow-carded (${Math.max(home, away)} to ${Math.min(home, away)}).` : 'Even count, so nobody would be carded.' }
        ];
      } else {
        const t = foulInfo.team;
        const crease = ubus.filter(b => b.team === t && presenter.isCreasing(b, t)).length;
        const allowed = Math.max(1, ubus.filter(b => b.team === 1 - t && ububallMatch.inAttackZone(P, b, t)).length);
        title = 'Goal camping';
        lines = [
          { text: `${t ? 'Away' : 'Home'} has ${crease} ubus in the crease (allowance: ${allowed}).` },
          { text: `Move ${Math.max(1, crease - allowed)} out this turn.`, act: true },
          { text: 'Otherwise every ubu left in the crease is yellow-carded.' }
        ];
      }
      const key = title + JSON.stringify(lines);
      if (key !== foulInfoKey) {
        foulInfoKey = key;
        foulBox.querySelector('span').textContent = title;
        foulBox.querySelector('div').replaceChildren(...lines.map(l => {
          const p = doc.createElement('p'); p.textContent = l.text; if (l.act) p.className = 'act'; return p;
        }));
      }
      const rect = canvas.getBoundingClientRect(), areaRect = stageArea.getBoundingClientRect();
      const far = foulInfo.kind === 'crease' ? foulInfo.team === 0 : (fouls.corner ?? 0) % 2 === 0;
      const along = view.portrait ? (far ? 0.27 : 0.73) : (far ? 0.7 : 0.3);
      foulBox.style.width = Math.min(320, rect.width * 0.46) + 'px';
      foulBox.style.left = (rect.left - areaRect.left + rect.width * (view.portrait ? 0.5 : along)) + 'px';
      foulBox.style.top = (rect.top - areaRect.top + rect.height * (view.portrait ? along : 0.5)) + 'px';
    }

    function stopAllAudio() {
      clearTimeout(sizzleTimer);
      sizzleTimer = null;
      presenter.quench();
      presenter.stopFanfare();
      ubuAudio?.stop?.();
    }

    let draggingPlan = false;
    let dragMoved = false;
    let dragTapGuards = false;
    let lastDragScrapePt = null;
    let lastDragScrapeAt = 0;
    let planDriver = null;
    let rafId = 0;
    let lastRaf = 0;
    function scheduleLoop() {
      if (!rafId && !paused && !doc.hidden) {
        lastRaf = 0;
        rafId = requestAnimationFrame(tickFrame);
      }
    }

    const CAST_SECONDS = 0.45, CAST_STAGGER = 0.05;
    const POSITIONS = ['Back', 'Top', 'Bottom'];

    function clearStageLayers() {
      castState = null;
      stageChoreoActive = false;
      view.castHidden = false;
      rinkWrap.classList.remove('cast-away');
      if (lineupAnim) { try { lineupAnim.cancel(); } catch {} lineupAnim = null; }
      const fxLineup = $('fx-lineup');
      if (fxLineup) {
        fxLineup.replaceChildren();
        fxLineup.style.opacity = '';
        fxLineup.style.translate = '';
      }
      mintSpots = [];
      mintTargetSpots = [];
      const fxMint = $('fx-mint');
      if (fxMint) fxMint.hidden = true;
      const fxMintUbus = $('fx-mint-ubus');
      if (fxMintUbus) fxMintUbus.replaceChildren();
    }

    function applyCastPose(t) {
      if (!castState) return;
      view.bodies.forEach((b, i) => {
        const home = castState.home[i];
        if (!home) return;
        const local = Math.max(0, Math.min(1, (t - i * CAST_STAGGER) / (1 - 6 * CAST_STAGGER)));
        const far = local * local * 820;
        const ox = home.x - 500, oy = home.y - 300, len = Math.hypot(ox, oy);
        b.x = home.x + (len > 1 ? ox / len : 0) * far;
        b.y = home.y + (len > 1 ? oy / len : -1) * far;
        b.rotation = home.rotation + local * local * (i % 2 ? -5 : 5);
      });
    }

    function runStageCast(mode = 'scatter') {
      stageChoreoActive = true;
      const away = mode !== 'return';
      const home = castState?.home || view.bodies.map(b => ({ x: b.x, y: b.y, rotation: b.rotation || 0 }));
      if (!away && !castState) {
        castState = { home, t: 1, away: false };
        applyCastPose(1);
      } else {
        castState = { home, t: castState ? castState.t : (away ? 0 : 1), away };
      }
      view.castHidden = false;
      rinkWrap.classList.remove('cast-away');
      if (isReduced()) {
        castState.t = away ? 1 : 0;
        finishCastIfDone();
      } else {
        applyCastPose(castState.t);
      }
      draw();
    }

    function finishCastIfDone() {
      if (!castState) return;
      if (castState.away && castState.t >= 1) {
        castState.home.forEach((h, i) => {
          view.bodies[i].x = h.x; view.bodies[i].y = h.y; view.bodies[i].rotation = h.rotation;
        });
        view.castHidden = true;
        rinkWrap.classList.add('cast-away');
        castState = null;
      } else if (!castState.away && castState.t <= 0) {
        castState.home.forEach((h, i) => {
          view.bodies[i].x = h.x; view.bodies[i].y = h.y; view.bodies[i].rotation = h.rotation;
        });
        view.castHidden = false;
        rinkWrap.classList.remove('cast-away');
        castState = null;
      }
    }

    function buildLineupCards(host) {
      const kickoff = P.kickoff();
      host.replaceChildren(...[0, 1, 2].map(i => {
        const entry = view.entries[i];
        const spot = kickoff[i];
        ububallMatch.applyStats(P, spot, entry.model.stats, 'standard');
        const slot = doc.createElement('div');
        slot.className = 'formation-slot' + (i === 0 ? ' is-selected' : '');
        slot.dataset.position = POSITIONS[i].toLowerCase();
        slot.style.setProperty('--x', spot.x / 10 + '%');
        slot.style.setProperty('--y', spot.y / 6 + '%');
        slot.style.setProperty('--r', String(spot.radius / 5));

        const pick = doc.createElement('div');
        pick.className = 'formation-pick';
        const pos = Object.assign(doc.createElement('span'), { className: 'formation-pos', textContent: POSITIONS[i] });
        const art = ubuRender.spriteImg ? ubuRender.spriteImg(entry.model, 'formation-art', 256) : ubuRender(entry.model, 'formation-art');
        const nameWrap = doc.createElement('span');
        nameWrap.className = 'formation-name';
        nameWrap.append(Object.assign(doc.createElement('strong'), { textContent: entry.model.parts.fullName }));
        pick.append(pos, art, nameWrap);

        const sup = entry.equippedSuper || P.SUPERS[i];
        const supBadge = doc.createElement('span');
        supBadge.className = 'formation-super';
        const supImg = Object.assign(doc.createElement('img'), { src: sup.icon, alt: '' });
        const supTxt = Object.assign(doc.createElement('span'), { textContent: sup.displayName || sup.name });
        supBadge.append(supImg, supTxt);

        slot.append(pick, supBadge);
        return slot;
      }));
    }

    function runStageLineup(variant = 'arrive') {
      stageChoreoActive = true;
      const host = $('fx-lineup');
      if (!host) return;
      buildLineupCards(host);
      if (lineupAnim) { try { lineupAnim.cancel(); } catch {} lineupAnim = null; }
      const off = { translate: '-45cqw 0', opacity: 0 }, at = { translate: '0 0', opacity: 1 };
      if (variant === 'depart') {
        const home = view.bodies.map(b => ({ x: b.x, y: b.y, rotation: b.rotation || 0 }));
        castState = { home, t: 1, away: true };
        finishCastIfDone();
        host.style.translate = '0 0';
        host.style.opacity = '1';
        timedCallbacks.push({
          at: 0.32,
          fn: () => {
            if (!isReduced() && host.animate) {
              lineupAnim = host.animate([at, off], { duration: 260 / speedMultiplier, easing: 'ease-in', fill: 'forwards' });
              lineupAnim.onfinish = () => { host.replaceChildren(); lineupAnim = null; };
            } else {
              host.replaceChildren();
            }
            castState = { home, t: 1, away: false };
            applyCastPose(1);
            view.castHidden = false;
            rinkWrap.classList.remove('cast-away');
          }
        });
      } else {
        runStageCast('scatter');
        if (!isReduced() && host.animate) {
          lineupAnim = host.animate([off, at], {
            duration: 480 / speedMultiplier,
            delay: 240 / speedMultiplier,
            easing: 'cubic-bezier(.2, .8, .2, 1)',
            fill: 'both'
          });
        }
      }
      draw();
    }

    function hexRgb(hex) {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return [255, 236, 210];
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function setFxMintSpots(spots) {
      mintTargetSpots = spots.map(s => ({ ...s }));
      if (!mintSpots.length || isReduced()) {
        mintSpots = spots.map(s => ({ ...s }));
      }
    }

    function paintFxMintLights() {
      const fxMint = $('fx-mint'), lightCanvas = $('fx-mint-lights');
      if (!fxMint || fxMint.hidden || !lightCanvas) return;
      const w = Math.max(1, Math.round((lightCanvas.clientWidth || 540) * (root.devicePixelRatio || 1)));
      const h = Math.max(1, Math.round((lightCanvas.clientHeight || 300) * (root.devicePixelRatio || 1)));
      if (lightCanvas.width !== w || lightCanvas.height !== h) {
        lightCanvas.width = w;
        lightCanvas.height = h;
      }
      const lctx = lightCanvas.getContext('2d');
      lctx.clearRect(0, 0, w, h);
      lctx.fillStyle = 'rgba(8, 10, 16, 0.80)';
      lctx.fillRect(0, 0, w, h);

      lctx.save();
      lctx.globalCompositeOperation = 'destination-out';
      for (const s of mintSpots) {
        if (s.alpha <= 0.01) continue;
        const cx = (s.x / 100) * w, cy = (s.y / 100) * h, rad = (s.r / 100) * w;
        const g = lctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, `rgba(0,0,0,${Math.min(1, s.alpha * 0.96)})`);
        g.addColorStop(0.55, `rgba(0,0,0,${Math.min(1, s.alpha * 0.62)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        lctx.fillStyle = g;
        lctx.beginPath();
        lctx.arc(cx, cy, rad, 0, Math.PI * 2);
        lctx.fill();
      }
      lctx.restore();

      lctx.save();
      lctx.globalCompositeOperation = 'lighter';
      for (const s of mintSpots) {
        if (s.alpha <= 0.01) continue;
        const [r, gCol, b] = hexRgb(s.color);
        const cx = (s.x / 100) * w, cy = (s.y / 100) * h, rad = (s.r / 100) * w * 1.12;
        const g = lctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g.addColorStop(0, `rgba(${r},${gCol},${b},${(0.30 * s.alpha).toFixed(3)})`);
        g.addColorStop(0.5, `rgba(${r},${gCol},${b},${(0.11 * s.alpha).toFixed(3)})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        lctx.fillStyle = g;
        lctx.beginPath();
        lctx.arc(cx, cy, rad, 0, Math.PI * 2);
        lctx.fill();
      }
      lctx.restore();
    }

    function runStageMint(variant = 'scamper-5') {
      stageChoreoActive = true;
      runStageCast('scatter');
      const fxMint = $('fx-mint'), host = $('fx-mint-ubus');
      if (!fxMint || !host) return;
      fxMint.hidden = false;
      host.replaceChildren();

      if (variant?.startsWith('charge-')) {
        const st = Math.max(1, Math.min(5, Number(variant.slice(7)) || 3));
        const voltMix = ['#ffecd2', '#82b6ff', '#579aff', '#2c7eff', '#126fff', '#0066FF'][st];
        const xs = [23, 50, 77];
        setFxMintSpots(xs.map((x, i) => ({
          id: 'p-' + i, x, y: 50, r: i === 1 ? 15 + st * 0.9 : 14.5, alpha: i === 1 ? 1 : 0.85,
          color: i === 1 ? voltMix : '#ffecd2'
        })));
        activeAudio()?.playPack?.('deal', { charges: [0, st, 0] });
        timedCallbacks.push({
          at: 0.42,
          fn: () => {
            setFxMintSpots([{ id: 'p-1', x: 50, y: 50, r: 19 + st * 0.9, alpha: 1, color: voltMix }]);
            activeAudio()?.playPack?.('pick', { charge: st });
          }
        });
        timedCallbacks.push({
          at: 0.78,
          fn: () => activeAudio()?.playPack?.('charge', { stage: st })
        });
        paintFxMintLights();
        return;
      }
      if (variant === 'deal') {
        const xs = [23, 50, 77];
        setFxMintSpots(xs.map((x, i) => ({
          id: 'p-' + i, x, y: 50, r: 16, alpha: 0.95,
          color: view.entries[i]?.model?.attributes?.background?.hex || '#ffecd2'
        })));
        activeAudio()?.playPack?.('deal');
        paintFxMintLights();
        return;
      }
      if (variant === 'pick' || variant === 'crack') {
        const xs = [23, 50, 77];
        setFxMintSpots(xs.map((x, i) => ({ id: 'p-' + i, x, y: 50, r: 15, alpha: 0.9, color: '#ffecd2' })));
        if (variant === 'pick') {
          timedCallbacks.push({
            at: 0.25,
            fn: () => {
              setFxMintSpots([{ id: 'p-1', x: 50, y: 50, r: 21, alpha: 1, color: '#ff9954' }]);
              activeAudio()?.playPack?.('pick');
            }
          });
        } else {
          setFxMintSpots([{ id: 'egg', x: 50, y: 50, r: 18, alpha: 0.95, color: '#ffecd2' }]);
          [1, 2, 3].forEach(stage => {
            timedCallbacks.push({
              at: (stage - 1) * 0.42 + 0.12,
              fn: () => {
                setFxMintSpots([{ id: 'egg', x: 50, y: 50, r: 17 + stage * 2.2, alpha: 1, color: stage === 3 ? '#ff9954' : '#ffecd2' }]);
                activeAudio()?.playPack?.('crack', { stage });
              }
            });
          });
        }
        paintFxMintLights();
        return;
      }

      const count = variant === 'scamper-3' ? 3 : 5;
      const xs = count === 3 ? [31, 50, 69] : [24, 37, 50, 63, 76];
      const isSpecialDemo = variant === 'special-reveal';
      const ubuEls = Array.from({ length: count }, (_, i) => {
        const entry = view.entries[i % view.entries.length];
        const charged = isSpecialDemo ? (i === 1 || i === 3 || i === 4) : false;
        const material = isSpecialDemo ? (i === 2 || i === 4) : false;
        const btn = doc.createElement('div');
        btn.className = 'mint-ubu is-silhouetted' + (charged ? ' is-charged' : '') + (material ? ' is-material' : '');
        btn.style.setProperty('--ubu-x', xs[i] + '%');
        btn.style.setProperty('--ubu-size', (count === 3 ? 8.2 : 7.0) + '%');
        const svg = ubuRender.spriteImg ? ubuRender.spriteImg(entry.model, 'mint-ubu-svg', 256) : ubuRender(entry.model, 'mint-ubu-svg');
        btn.append(svg);
        if (charged) {
          const NS = 'http://www.w3.org/2000/svg';
          const fx = doc.createElement('span'); fx.className = 'ubu-charge-fx';
          const arcSvg = doc.createElementNS(NS, 'svg'); arcSvg.setAttribute('viewBox', '-64 -64 128 128');
          ['M-50 -16 L-58 -26 L-46 -36 L-52 -46 L-36 -52', 'M34 -48 L46 -55 L42 -39 L55 -34 L48 -20', 'M46 18 L57 28 L44 37 L50 48 L34 52'].forEach((d, k) => {
            const p = doc.createElementNS(NS, 'path'); p.setAttribute('d', d); p.setAttribute('class', `volt-arc volt-arc-${k + 1}`); arcSvg.append(p);
          });
          fx.append(arcSvg); btn.append(fx);
        }
        host.append(btn);
        const silColor = charged && material ? '#d9ecff' : charged ? '#8ec0ff' : material ? '#fff0c2' : '#ffecd2';
        return { el: btn, color: entry.model.attributes.background.hex || '#ffecd2', silColor, charged, material, x: xs[i] };
      });

      setFxMintSpots(ubuEls.map((u, i) => ({ id: 'u-' + i, x: u.x, y: 50, r: 9.5, alpha: 0.92, color: u.silColor })));
      paintFxMintLights();

      ubuEls.forEach((u, i) => {
        timedCallbacks.push({
          at: (isSpecialDemo ? 0.55 : 0.35) + i * 0.18,
          fn: () => {
            u.el.classList.remove('is-silhouetted');
            u.el.classList.add('is-revealed');
            setFxMintSpots(ubuEls.map((item, j) => ({
              id: 'u-' + j, x: item.x, y: 50, r: j === i ? 12 : 9.5, alpha: j <= i ? 0.96 : 0.82,
              color: j <= i ? item.color : item.silColor
            })));
            if (i === 0 || i === count - 1 || u.charged || u.material) {
              activeAudio()?.playPack?.('reveal', { charged: u.charged, material: u.material });
            }
          }
        });
      });

      const scamperAt = 0.45 + count * 0.18 + 0.35;
      timedCallbacks.push({
        at: scamperAt,
        fn: () => {
          activeAudio()?.playPack?.('scamper', { count });
          setFxMintSpots([{ id: 'center', x: 50, y: 50, r: 16, alpha: 0.32, color: '#ffecd2' }]);
          if (!isReduced()) {
            ubuEls.forEach((u, i) => {
              const slot = i - (count - 1) / 2;
              const dx = slot * 22 + (i % 2 ? -14 : 14);
              const dy = (i % 2 ? -1 : 1) * (38 + Math.abs(slot) * 6);
              const spin = (i % 2 ? 1 : -1) * 28;
              u.el.animate?.([
                { translate: '-50% -50%', rotate: '0deg', scale: 1, opacity: 1 },
                { translate: '-50% -68%', rotate: `${-spin * 0.35}deg`, scale: 1.12, opacity: 1, offset: 0.2 },
                { translate: `calc(-50% + ${dx}cqw) calc(-50% + ${dy}cqw)`, rotate: `${spin}deg`, scale: 0.62, opacity: 0 }
              ], { duration: 480 / speedMultiplier, delay: (i * 45) / speedMultiplier, easing: 'cubic-bezier(.3, .1, .7, 1)', fill: 'forwards' });
            });
          } else {
            host.replaceChildren();
          }
        }
      });
    }

    function advanceStageChoreo(dt) {
      if (dt <= 0) return;
      if (phase === 'plan' && (timedCallbacks.length > 0 || stageChoreoActive)) {
        elapsed += dt;
        for (let i = timedCallbacks.length - 1; i >= 0; i--) {
          if (elapsed >= timedCallbacks[i].at) {
            const fn = timedCallbacks[i].fn;
            timedCallbacks.splice(i, 1);
            fn();
          }
        }
      }
      if (castState) {
        const step = isReduced() ? 1 : dt / CAST_SECONDS;
        castState.t = castState.away ? Math.min(1, castState.t + step) : Math.max(0, castState.t - step);
        if (castState.away ? castState.t < 1 : castState.t > 0) applyCastPose(castState.t);
        else finishCastIfDone();
      }
      if (mintTargetSpots.length) {
        const byId = new Map(mintSpots.map(s => [s.id, s]));
        const next = [];
        const k = isReduced() ? 1 : Math.min(1, dt * 9);
        for (const tgt of mintTargetSpots) {
          const cur = byId.get(tgt.id);
          if (!cur) next.push({ ...tgt, alpha: tgt.alpha * k });
          else {
            next.push({
              id: tgt.id,
              x: cur.x + (tgt.x - cur.x) * k,
              y: cur.y + (tgt.y - cur.y) * k,
              r: cur.r + (tgt.r - cur.r) * k,
              alpha: cur.alpha + (tgt.alpha - cur.alpha) * k,
              color: tgt.color
            });
          }
        }
        mintSpots = next;
        paintFxMintLights();
      }
    }

    function resetStage({ phase: nextPhase = 'plan', mode = 'standard', glow = 0 } = {}) {
      draggingPlan = false;
      dragMoved = false;
      lastDragScrapePt = null;
      lastDragScrapeAt = 0;
      planDriver = null;
      stopAllAudio();
      clearStageLayers();
      clearTimeout(bugTabTimer); bugTabTimer = 0; bugTabs.length = 0; $('bug-tab')?.classList.remove('show');
      clearTimeout(bannerTimer); $('field-banner')?.classList.remove('show');
      timedCallbacks = [];
      forcedGoalLabel = null;
      goalReplay = null;
      postGoal = null;
      scoringPlayer = null;
      foulInfo = null;
      foulBox.hidden = true;
      view.mode = mode;
      showModeTags(mode);
      phase = nextPhase;
      elapsed = 0;
      accumulator = 0;
      scenarioElapsed = 0;
      hitStopUntil = 0;
      fouls = ububallMatch.newFouls();
      play = ububallMatch.newPlay();
      tally = ububallMatch.newTally();
      plans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, guard: false }));

      // Restore clean materials unless overridden by scenario
      view.entries.forEach((entry, i) => {
        setSkaterMaterial(i, i === 0 ? selectedMaterial : null);
      });

      const fresh = P.kickoff();
      fresh.slice(0, 6).forEach((b, i) => {
        const entry = view.entries[i];
        stats[i] = { ...entry.model.stats };
        ububallMatch.applyStats(P, b, stats[i], mode);
        b.name = entry.model.parts.fullName;
        b.voice = entry.model.voice;
        b.playerIndex = i;
        b.meter = 0;
        b.stunned = false;
        b.stunnedNext = false;
        b.carded = false;
        b.superArm = false;
        b.superActive = null;
        equipSuper(i, i === 0 ? selectedSuperId : (i % P.SUPERS.length));
      });
      view.bodies = fresh;
      presenter.clearEffects();
      fx.kickoffGlow = glow;
      presenter.dirtyPrediction();
      syncMeters(true);
      syncScorebug();
      draw();
    }

    function place(index, x, y, extra = {}) {
      const b = view.bodies[index];
      if (!b) return;
      b.x = x; b.y = y;
      Object.assign(b, extra);
    }

    function boostStats(index, overrides) {
      stats[index] = { ...stats[index], ...overrides };
      ububallMatch.applyStats(P, view.bodies[index], stats[index], view.mode);
    }

    function launchPlans(turnPlans = plans) {
      draggingPlan = false;
      planDriver = null;
      ubuAudio?.playAimScrape?.({ id: selected, speed: 0 });
      plans = turnPlans.map(p => ({ angle: 0, power: 0, spin: 0, guard: false, ...p }));
      phase = 'play';
      elapsed = 0;
      accumulator = 0;
      P.startTurn(view.bodies, plans, liveFx.super, liveFx.launch);
      syncMeters();
      syncScorebug();
      scheduleLoop();
    }

    function handleGoalScored(goalTeam) {
      scores[goalTeam]++;
      const cell = $(goalTeam ? 'bug-away-cell' : 'bug-home-cell')?.querySelector('.bug-score');
      if (cell) { cell.classList.remove('scored'); void cell.offsetWidth; cell.classList.add('scored'); }

      const ball = view.bodies[6];
      const burning = presenter.ballOnFire();
      if (burning) presenter.lightNet(goalTeam);
      else presenter.quench();

      const ownGoal = play.last !== null && view.bodies[play.last]?.team !== goalTeam;
      const scorerIdx = ownGoal ? -1 : (play.last ?? (goalTeam === 0 ? 0 : 3));
      scoringPlayer = scorerIdx >= 0 ? view.bodies[scorerIdx] : null;
      const label = forcedGoalLabel || (ownGoal ? 'OWN GOAL' : burning ? 'FIREBALL!' : 'GOAL');
      const assistIdx = !ownGoal && scorerIdx >= 0 ? play.assist[goalTeam] : null;
      if (assistIdx != null && assistIdx !== scorerIdx && view.bodies[assistIdx]) {
        presenter.popup(view.bodies[assistIdx], 'Assist');
      }

      presenter.celebrate(goalTeam, ball, label, label === 'OWN GOAL' || label.endsWith('WINS!') ? null : scoringPlayer);
      const tabCall = label.replace(/!$/, '').toLowerCase();
      bugTab(scoringPlayer && !label.endsWith('WINS!') ? `${tabCall} · ${scoringPlayer.name}` : tabCall, { team: goalTeam, colour: true });
      if (scoringPlayer?.voice) presenter.loopFanfare(scoringPlayer.voice);
      phase = 'goal';
      postGoal = { ticks: 0 };
      P.pinGoalBall?.(view.bodies, goalTeam);
      syncScorebug();
    }

    function startGoalReplayDemo() {
      resetStage({ phase: 'play', mode: 'standard' });
      place(0, 620, 325);
      place(6, 700, 300);
      place(3, 830, 160);
      place(4, 830, 440);
      const segPlans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, guard: false }));
      segPlans[0] = { angle: -0.22, power: 0.96, spin: 0.65, guard: false };
      // Pre-measure exact ticks to goal on a clone so replaySpeed ramps accurately into slow motion
      const probe = structuredClone(view.bodies);
      P.startTurn(probe, segPlans);
      let total = 0;
      while (total < 240) {
        total++;
        if (P.step(probe, P.DT) !== null) break;
      }
      goalReplay = {
        initial: structuredClone(view.bodies),
        plans: segPlans,
        total,
        played: 0,
        postTicks: 0,
        acc: 0,
        scored: false
      };
      P.startTurn(view.bodies, segPlans, liveFx.super);
      syncScorebug();
    }

    function stepSimulationTick() {
      // Check scheduled scenario callbacks
      for (let i = timedCallbacks.length - 1; i >= 0; i--) {
        if (elapsed >= timedCallbacks[i].at) {
          const fn = timedCallbacks[i].fn;
          timedCallbacks.splice(i, 1);
          fn();
        }
      }

      if (goalReplay) {
        elapsed += P.DT;
        if (!goalReplay.scored) {
          goalReplay.played++;
          const g = P.step(view.bodies, P.DT, liveFx.collide, liveFx.wall, liveFx.shockwave, liveFx.super);
          presenter.recordTrails();
          if (g !== null || goalReplay.played >= goalReplay.total) {
            goalReplay.scored = true;
            presenter.celebrate(0, view.bodies[6], 'SNIPE!', view.bodies[0]);
            P.pinGoalBall?.(view.bodies, 0);
          }
        } else {
          goalReplay.postTicks++;
          P.stepPostGoal(view.bodies, P.DT, liveFx.collide, liveFx.wall, liveFx.shockwave, liveFx.super);
          presenter.recordTrails();
        }
        return;
      }

      if (postGoal) {
        elapsed += P.DT;
        postGoal.ticks++;
        P.stepPostGoal(view.bodies, P.DT, liveFx.collide, liveFx.wall, liveFx.shockwave, liveFx.super);
        presenter.recordTrails();
        if (P.settled(view.bodies.slice(0, 6))) {
          P.stop(view.bodies);
          postGoal = null;
        }
        return;
      }

      if (phase === 'play') {
        const tick = ububallMatch.playTick(P, view.bodies, play, liveFx, tally);
        elapsed += P.DT;
        matchTicks++;
        ububallMatch.lapseFouls(P, view.bodies, fouls);
        for (const s of tick.saves) creditSave(view.bodies[s.index], s.own, Boolean(s.iron));
        if (tick.struck) presenter.popup(view.bodies[6], 'Spin strike!');
        if (tick.stop) {
          presenter.impact(tick.stop, tick.goal !== null ? (ububallMatch.SCREEN_SHAKE?.goal ?? 2) : (ububallMatch.SCREEN_SHAKE?.default ?? 1));
          accumulator = 0;
        }
        presenter.recordTrails();
        if (tick.goal !== null) {
          handleGoalScored(tick.goal);
        } else if (P.settled(view.bodies) || Math.round(elapsed / P.DT) >= ububallMatch.turnTicks(view.mode)) {
          P.endTurn?.(view.bodies);
          phase = 'plan';
          presenter.quench();
          syncScorebug();
        }
      }
    }

    function stepManualTicks(count) {
      paused = true;
      updatePauseButton();
      hitStopUntil = 0;
      for (let i = 0; i < count; i++) {
        clockMs += P.DT * 1000;
        if (phase === 'plan' && !stageChoreoActive && !timedCallbacks.length && i === 0) launchPlans(plans);
        else if (phase !== 'plan') stepSimulationTick();
        advanceStageChoreo(P.DT);
        presenter.emitSkaterEffects(P.DT);
        presenter.updatePopups(P.DT);
        presenter.updateEffects(P.DT);
      }
      draw();
      updateTelemetry();
    }

    function draw() {
      if (view.portrait) {
        stageArea.classList.add('is-portrait');
        const w = stageArea.clientWidth || 360, h = stageArea.clientHeight || 600;
        rinkWrap.style.width = h + 'px';
        rinkWrap.style.height = w + 'px';
        rinkWrap.style.top = '50%';
        rinkWrap.style.left = '50%';
        rinkWrap.style.transform = 'translate(-50%, -50%) rotate(-90deg)';
      } else {
        stageArea.classList.remove('is-portrait');
        rinkWrap.style.width = '100%';
        rinkWrap.style.height = '100%';
        rinkWrap.style.top = '';
        rinkWrap.style.left = '';
        rinkWrap.style.transform = '';
      }
      presenter.drawScene();
      paintFxMintLights();
      updateFoulInfo();
    }

    function updateTelemetry() {
      const ball = view.bodies[6];
      const bSpeed = ball ? Math.round(Math.hypot(ball.vx, ball.vy)) : 0;
      const bPace = ball ? Math.round(Math.max(bSpeed, ball.pace || 0)) : 0;
      const heat = ball ? presenter.ballHeat(ball).toFixed(1) : '0.0';
      const fireTag = presenter.ballOnFire() ? ' · FIRE' : '';
      const stopTag = clockMs < hitStopUntil ? ' · HIT-STOP' : '';
      const label = activeDemo ? activeDemo.title : 'Idle';
      const rInfo = presenter.getRendererInfo ? presenter.getRendererInfo() : { backend: 'canvas2d' };
      const rTag = rInfo.backend === 'webgl2' ? 'WebGL2' : 'Canvas2D';
      $('stage-telemetry').textContent =
        `[${rTag}] ${label} | ${phase.toUpperCase()} ${elapsed.toFixed(2)}s | Ball ${bSpeed} px/s (pace ${bPace}, heat ${heat}${fireTag}) | ` +
        `Particles ${fx.particles.length} · Waves ${fx.shockwaves.length} · Skids ${fx.skids.length} · Burns ${fx.burns.length}${stopTag}`;
    }

    const workbenchCtx = {
      P,
      ububallMatch,
      presenter,
      liveFx,
      get bodies() { return view.bodies; },
      get entries() { return view.entries; },
      get plans() { return plans; },
      get fouls() { return fouls; },
      get play() { return play; },
      get stats() { return stats; },
      get fx() { return fx; },
      audio: activeAudio,
      voice: () => view.entries[0]?.model?.voice,
      getSelectedMaterial: () => selectedMaterial,
      getSelectedSuperId: () => selectedSuperId,
      setSelected: idx => { selected = idx; },
      idlePlans: () => Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, guard: false })),
      resetStage,
      place,
      boostStats,
      equipSuper,
      setSkaterMaterial,
      launchPlans,
      syncMeters,
      bugTab,
      banner,
      openFoulInfo,
      setForcedGoalLabel: lbl => { forcedGoalLabel = lbl; },
      startGoalReplayDemo,
      runStageCast,
      runStageLineup,
      runStageMint,
      after: (sec, fn) => timedCallbacks.push({ at: sec, fn }),
      setPlanDriver: fn => { planDriver = typeof fn === 'function' ? fn : null; },
      playTimedSizzle(seconds = 1.5) {
        const a = activeAudio();
        if (!a) return;
        clearTimeout(sizzleTimer);
        presenter.quench();
        fx.sizzle = a.playSizzle({ duration: seconds });
        sizzleTimer = setTimeout(() => presenter.quench(), seconds * 1000);
      },
      playSampleFanfare(loop = false) {
        const a = activeAudio();
        if (!a) return;
        presenter.stopFanfare();
        a.playFanfare(view.entries[0].model.voice, null, null, { loop });
      }
    };

    function runDemo(item, variant = item.variants?.[0]?.id) {
      activeDemo = item;
      activeVariant = variant;
      paused = false;
      updatePauseButton();
      for (const el of doc.querySelectorAll('.effect-card')) {
        el.classList.toggle('is-active', el.dataset.effectId === item.id);
      }
      item.run(workbenchCtx, variant);
      updateTelemetry();
      scheduleLoop();
    }

    // Build Catalog UI from EFFECT_GROUPS
    function renderCatalog() {
      const jumps = $('group-jumps');
      const container = $('effects-groups');
      jumps.replaceChildren();
      container.replaceChildren();

      for (const group of EFFECT_GROUPS) {
        const pill = doc.createElement('button');
        pill.type = 'button';
        pill.className = 'group-pill';
        pill.textContent = `${group.title} (${group.items.length})`;
        pill.onclick = () => doc.getElementById(`group-${group.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        jumps.append(pill);

        const section = doc.createElement('section');
        section.className = 'effect-group';
        section.id = `group-${group.id}`;
        section.dataset.groupId = group.id;

        const header = doc.createElement('div');
        header.className = 'effect-group-header';
        const h2 = doc.createElement('h2');
        h2.textContent = group.title;
        const summary = doc.createElement('span');
        summary.className = 'effect-group-summary';
        summary.textContent = group.summary;
        header.append(h2, summary);

        const grid = doc.createElement('div');
        grid.className = 'effect-cards';

        for (const item of group.items) {
          const card = doc.createElement('article');
          card.className = 'effect-card';
          card.dataset.effectId = item.id;
          card.dataset.search = `${group.title} ${item.title} ${item.when} ${item.visual} ${item.soundLabel || ''}`.toLowerCase();

          const top = doc.createElement('div');
          top.className = 'effect-card-top';

          const titleRow = doc.createElement('div');
          titleRow.className = 'effect-title-row';
          const h3 = doc.createElement('h3');
          h3.textContent = item.title;
          const badge = doc.createElement('span');
          badge.className = 'effect-badge' + (item.playSound ? ' has-sound' : '');
          badge.textContent = item.playSound ? 'Visual + Sound' : 'Visual';
          titleRow.append(h3, badge);

          const setFormattedText = (el, text) => {
            const parts = String(text).split(/`([^`]+)`/g);
            parts.forEach((part, idx) => {
              if (!part) return;
              if (idx % 2 === 1) {
                const code = doc.createElement('code');
                code.textContent = part;
                el.append(code);
              } else {
                el.append(part);
              }
            });
          };
          const when = doc.createElement('p');
          when.className = 'effect-when';
          setFormattedText(when, item.when);

          const desc = doc.createElement('p');
          desc.className = 'effect-desc';
          setFormattedText(desc, item.visual);

          top.append(titleRow, when, desc);

          let selectedVariant = item.variants?.[0]?.id;
          if (item.variants?.length) {
            const varRow = doc.createElement('div');
            varRow.className = 'effect-variants';
            item.variants.forEach((v, idx) => {
              const vBtn = doc.createElement('button');
              vBtn.type = 'button';
              vBtn.className = 'variant-pill' + (idx === 0 ? ' is-selected' : '');
              vBtn.textContent = v.label;
              vBtn.onclick = () => {
                selectedVariant = v.id;
                for (const sibling of varRow.children) sibling.classList.toggle('is-selected', sibling === vBtn);
                runDemo(item, selectedVariant);
              };
              varRow.append(vBtn);
            });
            top.append(varRow);
          }

          const actions = doc.createElement('div');
          actions.className = 'effect-actions';
          const runBtn = doc.createElement('button');
          runBtn.type = 'button';
          runBtn.className = 'fx-btn primary';
          runBtn.textContent = 'Play scenario';
          runBtn.onclick = () => runDemo(item, selectedVariant);
          actions.append(runBtn);

          if (item.playSound) {
            const soundBtn = doc.createElement('button');
            soundBtn.type = 'button';
            soundBtn.className = 'fx-btn sound';
            soundBtn.textContent = item.soundLabel || 'Play sound';
            soundBtn.onclick = () => {
              if (muted) {
                muted = false;
                $('btn-mute').setAttribute('aria-pressed', 'false');
              }
              item.playSound(workbenchCtx, selectedVariant);
            };
            actions.append(soundBtn);
          }

          card.append(top, actions);
          grid.append(card);
        }

        section.append(header, grid);
        container.append(section);
      }
    }

    // Populate pickers dynamically from shared game constants
    function populatePickers() {
      const matSelect = $('ctl-material');
      const noneOpt = Object.assign(doc.createElement('option'), { value: '', textContent: 'Matte (No Material)' });
      matSelect.append(noneOpt);
      for (const [key, [shape]] of Object.entries(MATERIAL_STYLES)) {
        const label = key.replace(/(^|-)([a-z])/g, (_, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase());
        const opt = Object.assign(doc.createElement('option'), { value: key, textContent: `${label} (${shape})` });
        if (key === selectedMaterial) opt.selected = true;
        matSelect.append(opt);
      }
      matSelect.onchange = () => {
        selectedMaterial = matSelect.value || null;
        setSkaterMaterial(0, selectedMaterial);
        if (activeDemo?.id === 'material-particles') runDemo(activeDemo, 'selected');
        else draw();
      };

      const superSelect = $('ctl-super');
      P.SUPERS.forEach(s => {
        const opt = Object.assign(doc.createElement('option'), { value: String(s.id), textContent: `${String(s.id).padStart(2, '0')} · ${s.name}` });
        if (s.id === selectedSuperId) opt.selected = true;
        superSelect.append(opt);
      });
      superSelect.onchange = () => {
        selectedSuperId = Number(superSelect.value);
        equipSuper(0, selectedSuperId, selectedMastery);
        if (activeDemo?.id === 'super-auras') runDemo(activeDemo, activeVariant);
        else { presenter.dirtyPrediction(); draw(); }
      };

      $('ctl-mastery').onchange = e => {
        selectedMastery = Number(e.target.value);
        equipSuper(0, selectedSuperId, selectedMastery);
        presenter.dirtyPrediction();
        draw();
      };

      const applyColors = () => {
        doc.documentElement.style.setProperty('--team-home', $('ctl-home-color').value);
        doc.documentElement.style.setProperty('--team-away', $('ctl-away-color').value);
        presenter.invalidateTheme();
        draw();
      };
      $('ctl-home-color').oninput = applyColors;
      $('ctl-away-color').oninput = applyColors;
      $('btn-reset-colors').onclick = () => {
        $('ctl-home-color').value = '#e8ca48';
        $('ctl-away-color').value = '#aa54d3';
        doc.documentElement.style.removeProperty('--team-home');
        doc.documentElement.style.removeProperty('--team-away');
        presenter.invalidateTheme();
        draw();
      };
    }

    function updateVoiceReadout() {
      const entry = view.entries[0];
      if (!entry) return;
      $('voice-ubu-name').textContent = entry.model.parts.fullName;
      if (ubuAudio?.parseVoiceInfo) {
        const info = ubuAudio.parseVoiceInfo(entry.model.voice);
        $('voice-summary').textContent = `${info.instrument} · ${info.rootName} · ${info.scale} · ${info.tempoBpm} BPM`;
      }
    }

    function updatePauseButton() {
      const btn = $('btn-pause');
      btn.setAttribute('aria-pressed', String(paused));
      btn.textContent = paused ? 'Resume' : 'Pause';
    }

    // Interactive rink pointer support: click foul warnings to inspect, or drag aim arrows in `plan`!
    function rinkPoint(event) {
      const r = canvas.getBoundingClientRect();
      if (view.portrait) {
        return { x: (1 - (event.clientY - r.top) / r.height) * 1000, y: ((event.clientX - r.left) / r.width) * 600 };
      }
      return { x: ((event.clientX - r.left) / r.width) * 1000, y: ((event.clientY - r.top) / r.height) * 600 };
    }
    let lastWheelSpinTickAt = 0;
    canvas.addEventListener('wheel', e => {
      if (phase !== 'plan' || !e.deltaY || e.ctrlKey) return;
      e.preventDefault();
      planDriver = null;
      const prevSpin = plans[selected]?.spin || 0;
      const step = (e.shiftKey ? 0.16 : 0.08) * -Math.sign(e.deltaY);
      let nextSpin = Math.max(-1, Math.min(1, Math.round((prevSpin + step) * 100) / 100));
      if (Math.abs(nextSpin) < 0.035) nextSpin = 0;
      if (Math.abs(nextSpin - prevSpin) < 1e-4) return;
      plans[selected] = { ...plans[selected], spin: nextSpin, guard: false };
      const b = view.bodies[selected];
      const nowMs = performance.now();
      const crossedZero = (Math.abs(prevSpin) > 0.005 && Math.abs(nextSpin) <= 0.005) || (prevSpin * nextSpin < 0);
      if (crossedZero) {
        lastWheelSpinTickAt = nowMs;
        activeAudio()?.playSpinTick?.({ spin: 0, center: true, x: b?.x ?? 500, y: b?.y ?? 300 });
      } else if (nowMs - lastWheelSpinTickAt >= 18) {
        lastWheelSpinTickAt = nowMs;
        activeAudio()?.playSpinTick?.({ spin: nextSpin, center: false, x: b?.x ?? 500, y: b?.y ?? 300 });
      }
      presenter.dirtyPrediction();
      draw();
      scheduleLoop();
    }, { passive: false });
    canvas.addEventListener('pointerdown', e => {
      const p = rinkPoint(e);
      const warn = presenter.warningAt(p, fouls);
      if (warn) { openFoulInfo(warn); return; }
      if (phase !== 'plan') return;
      planDriver = null;
      const idx = view.bodies.slice(0, 3).findIndex(b => Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 18);
      if (idx >= 0) {
        dragTapGuards = selected === idx;
        selected = idx;
        draggingPlan = true;
        dragMoved = false;
        lastDragScrapePt = p;
        lastDragScrapeAt = performance.now();
        canvas.setPointerCapture(e.pointerId);
        draw();
      } else {
        const arrowIdx = view.bodies.slice(0, 3).findIndex((b, i) => {
          const g = impulseGeometry(P, b, plans[i]);
          return g.visible && Math.hypot(g.x - p.x, g.y - p.y) < 28;
        });
        if (arrowIdx >= 0) {
          dragTapGuards = false;
          selected = arrowIdx;
          draggingPlan = true;
          dragMoved = false;
          lastDragScrapePt = p;
          lastDragScrapeAt = performance.now();
          canvas.setPointerCapture(e.pointerId);
        }
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (!draggingPlan || phase !== 'plan') return;
      const p = rinkPoint(e), b = view.bodies[selected];
      if (!dragMoved && lastDragScrapePt && Math.hypot(p.x - lastDragScrapePt.x, p.y - lastDragScrapePt.y) < 4) return;
      dragMoved = true;
      const dx = p.x - b.x, dy = p.y - b.y, dist = Math.hypot(dx, dy);
      const geom = impulseGeometry(P, b, { angle: 0, power: 1, spin: plans[selected]?.spin || 0 });
      plans[selected].angle = Math.atan2(dy, dx);
      plans[selected].power = Math.max(0, Math.min(1, (dist - geom.ringR) / Math.max(1, geom.scale)));
      plans[selected].guard = false;
      const nowScrape = performance.now();
      if (lastDragScrapePt && lastDragScrapeAt > 0) {
        const dtS = Math.max(0.006, (nowScrape - lastDragScrapeAt) / 1000);
        const dragSpd = Math.hypot(p.x - lastDragScrapePt.x, p.y - lastDragScrapePt.y) / dtS;
        activeAudio()?.playAimScrape?.({ id: selected, speed: dragSpd, power: plans[selected].power, x: b.x, y: b.y });
      }
      lastDragScrapePt = p;
      lastDragScrapeAt = nowScrape;
      presenter.dirtyPrediction();
      draw();
      scheduleLoop();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(ev, event => {
        if (!draggingPlan) return;
        if (ev === 'pointerup' && phase === 'plan' && !dragMoved && dragTapGuards) {
          const nextG = !plans[selected].guard;
          plans[selected] = { ...plans[selected], guard: nextG };
          presenter.triggerGuardToggle?.(selected, nextG);
          presenter.dirtyPrediction();
          draw();
          scheduleLoop();
        }
        if (dragMoved) activeAudio()?.playAimScrape?.({ id: selected, speed: 0 });
        draggingPlan = false;
        dragMoved = false;
        dragTapGuards = false;
        lastDragScrapePt = null;
        lastDragScrapeAt = 0;
      });
    }

    // Wire transport & filter controls
    $('btn-replay').onclick = () => {
      if (activeDemo) runDemo(activeDemo, activeVariant);
      else runDemo(EFFECT_GROUPS[0].items[0]);
    };
    $('btn-pause').onclick = () => {
      paused = !paused;
      if (paused) {
        ubuAudio?.stopMotion?.();
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; lastRaf = 0; }
      } else {
        scheduleLoop();
      }
      updatePauseButton();
    };
    $('btn-step-1').onclick = () => stepManualTicks(1);
    $('btn-step-10').onclick = () => stepManualTicks(10);
    $('btn-launch-plan').onclick = () => { if (phase === 'plan') launchPlans(plans); };
    $('btn-reset').onclick = () => { activeDemo = null; resetStage({ phase: 'plan', mode: 'standard' }); updateTelemetry(); };
    $('btn-stop-audio').onclick = stopAllAudio;

    for (const btn of doc.querySelectorAll('.segmented button[data-speed]')) {
      btn.onclick = () => {
        speedMultiplier = Number(btn.dataset.speed);
        for (const b of btn.parentElement.children) b.classList.toggle('is-selected', b === btn);
      };
    }

    $('btn-loop').onclick = e => {
      autoLoop = !autoLoop;
      e.currentTarget.setAttribute('aria-pressed', String(autoLoop));
      if (autoLoop) scheduleLoop();
    };
    $('btn-reduced').onclick = e => {
      forceReducedMotion = !forceReducedMotion;
      e.currentTarget.setAttribute('aria-pressed', String(forceReducedMotion));
      draw();
    };
    $('btn-mute').onclick = e => {
      muted = !muted;
      e.currentTarget.setAttribute('aria-pressed', String(muted));
      if (muted) stopAllAudio();
    };
    $('btn-portrait').onclick = e => {
      view.portrait = !view.portrait;
      e.currentTarget.setAttribute('aria-pressed', String(view.portrait));
      presenter.dirtyPrediction();
      draw();
    };
    $('btn-random-dna').onclick = () => {
      const dna = ubu.randomDNA();
      const model = ubu.decode(dna);
      view.entries[0].dna = ubu.toCode(dna);
      view.entries[0].baseModel = model;
      view.entries[0].label = model.parts.fullName;
      setSkaterMaterial(0, selectedMaterial);
      view.bodies[0].name = model.parts.fullName;
      view.bodies[0].voice = model.voice;
      $(`meter-name-0`).textContent = model.parts.fullName;
      updateVoiceReadout();
      activeAudio()?.playVoice?.(model.voice);
    };

    $('effect-search').oninput = e => {
      const q = e.target.value.trim().toLowerCase();
      for (const section of doc.querySelectorAll('.effect-group')) {
        let visibleCount = 0;
        for (const card of section.querySelectorAll('.effect-card')) {
          const match = !q || card.dataset.search.includes(q);
          card.hidden = !match;
          if (match) visibleCount++;
        }
        section.hidden = visibleCount === 0;
      }
    };

    new ResizeObserver(() => draw()).observe(stageArea);

    function needsContinuousFrames() {
      if (paused || doc.hidden) return false;
      if (autoLoop && activeDemo) return true;
      if (phase !== 'plan' || postGoal || goalReplay || timedCallbacks.length || castState || stageChoreoActive) return true;
      if (planDriver || (presenter.pruneGuardSetTimes ? presenter.pruneGuardSetTimes() : Boolean(fx.guardSetTimes?.size)) || fx.contactMarks?.length || fx.guardFlexes?.length || fx.launchNicks?.length || fx.ubuRecoils?.length || fx.wallSmudges?.length || fx.tapeCatches?.length || fx.ballTapWarp) return true;
      if (fx.kickoffGlow > 0 || fx.fireWarp || fx.koWarp || fx.particles.length || fx.shockwaves.length || fx.skids.length || fx.burns.length || fx.pings?.length || fx.popups?.length) return true;
      if (fouls.crease.some(Boolean) || presenter.stalling(fouls)) return true;
      if (activeDemo) return true;
      return false;
    }

    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) {
        ubuAudio?.stopMotion?.();
        stopAllAudio();
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; lastRaf = 0; }
      } else if (needsContinuousFrames()) {
        scheduleLoop();
      }
    });

    // Main RAF loop (sleeps when idle, paused, or hidden)
    function tickFrame(now) {
      rafId = 0;
      if (paused || doc.hidden) { lastRaf = 0; return; }
      const rawDt = lastRaf ? Math.min(0.05, Math.max(0, (now - lastRaf) / 1000)) : 0;
      lastRaf = now;

      if (rawDt > 0) {
        let effectiveSpeed = speedMultiplier;
        if (goalReplay) {
          const base = goalReplay.scored ? 0.5 : ububallMatch.replaySpeed(Math.max(0, goalReplay.total - goalReplay.played));
          effectiveSpeed *= base;
        } else if (postGoal) {
          effectiveSpeed *= ububallMatch.postGoalSpeed(postGoal.ticks);
        }

        const scaledDt = rawDt * effectiveSpeed;
        clockMs += scaledDt * 1000;
        scenarioElapsed += rawDt * speedMultiplier;

        const frozenByHitStop = clockMs < hitStopUntil;
        const simDt = frozenByHitStop ? 0 : scaledDt;

        if (phase === 'plan' && planDriver && !draggingPlan) {
          planDriver(scenarioElapsed, rawDt * speedMultiplier);
        }
        presenter.updatePopups(rawDt * speedMultiplier);
        presenter.updateEffects(simDt);
        if (!frozenByHitStop) advanceStageChoreo(simDt);

        if (!frozenByHitStop && (phase === 'play' || postGoal || goalReplay)) {
          accumulator += simDt;
          let steps = 0;
          while (steps++ < 60 && accumulator >= P.DT && clockMs >= hitStopUntil) {
            accumulator -= P.DT;
            stepSimulationTick();
          }
          presenter.emitSkaterEffects(simDt);
        }

        if (autoLoop && activeDemo && scenarioElapsed >= (activeDemo.duration || 2.8)) {
          runDemo(activeDemo, activeVariant);
        }

        draw();
        updateTelemetry();
      }
      if (needsContinuousFrames()) {
        rafId = requestAnimationFrame(tickFrame);
      } else {
        lastRaf = 0;
      }
    }

    populatePickers();
    renderCatalog();
    rebuildSprites();
    resetStage({ phase: 'plan', mode: 'standard' });
    updateTelemetry();

    root.addEventListener?.('pagehide', () => presenter.dispose(), { once: true });
    return { workbenchCtx, runDemo, presenter };
  }

  const exported = { EFFECT_GROUPS, GOAL_CALL_VARIANTS, bootBrowserWorkbench };
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else {
    root.ububallEffectsDemo = exported;
    bootBrowserWorkbench();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
