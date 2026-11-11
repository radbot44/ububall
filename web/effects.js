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
          id: 'plan-prediction',
          title: 'Trajectory, Wall Stamps, Stop Marks & Pulse Ticks',
          when: 'Planning moves with board bounces, stops, or Pulse 1-second turns (`paintPrediction`).',
          visual: 'Dashed skater/ball paths fading toward horizon, translucent wall-impact stamps, settled `x` stop marks, and Pulse 1s turn-end ticks.',
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
          visual: 'Dashed golden 1.8x Colossus preview circle (`#ffe043cc`) alongside a Guard shield turning metallic iron (`#c3ccd6`).',
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
            // Skater 1 arms Colossus -> dashed 1.8x size ring preview
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
      summary: 'Moving ubu wobbles, puck glides, tapered spin arcs & spin wobble, ice hockey braking, front wind cones, and 32 DNA materials.',
      items: [
        {
          id: 'motion-trails',
          title: 'Skater & Ball Motion Trails',
          when: 'Skaters or ball move faster than 25 px/s (`recordTrails`, `drawTrails`).',
          visual: 'Smooth tapered team-colored and ball-heat-tinted gradient ribbons (0.24s life) that split cleanly at sharp bounce corners.',
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
          visual: 'Subtle speed-pitched wobble per skater: small light ubus flutter higher and faster; large heavy ubus hum deeper with warmer low-mid weight.',
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
          title: 'Spinning Wobble & Directional Tapered Arcs',
          when: 'Skaters or ball spin with `|omega| >= 2.5 rad/s` (`drawSpin`, `playSpin`).',
          visual: 'Spin blades taper from a vanishing tail to a bright forward-angled tip showing CW vs. CCW direction, paired with an upper-register gyroscopic spin wobble.',
          soundLabel: 'Play spin wobble',
          variants: [
            { id: 'compare', label: 'CW vs. CCW Direction' },
            { id: 'high-low', label: 'High Spin vs. Low Spin' }
          ],
          duration: 2.8,
          playSound: ctx => ctx.audio()?.playSpin?.({ omega: 16, radius: 25, duration: 0.9, preview: true }),
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
          visual: 'Dual-layer Gaussian-blurred dark ice gouges (`SKID_LIFE = 12s`) paired with an ice-hockey blade shave & snow-spray stop sound.',
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
          title: 'Corner Rim-Around (Skate Edge Carve)',
          when: 'Skater skims a 100 px curved corner arc (`vn <= 190`, `|vt| >= 150`) with co-rotating spin (`rimmed = true`).',
          visual: 'Fine ice-mist spray (`#e8f7ff` / `#ffffff`), curved corner skid mark, and the shared ice-hockey hard-brake edge shave sound.',
          soundLabel: 'Play ice brake',
          duration: 2.4,
          playSound: ctx => ctx.audio()?.playCarve({ volume: 0.5 }),
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
          title: 'Tailgating (Front Wind Cone & Continuous Slipstream)',
          when: 'Skater drafts behind any fast skater (`tailgateFactor > 0.22` cone, `> 0.35` continuous wind).',
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
        }
      ]
    },
    {
      id: 'impacts',
      title: '4. Shots, Impacts & Ball Heat',
      summary: 'Checks, Hip Clips, Daze swirls, Spin Strikes, Snap one-timers, wall/post/net physics, and Fireballs.',
      items: [
        {
          id: 'body-check-daze',
          title: 'Body Check, Hip Clip & Daze Dizzy Swirl',
          when: 'Hard check (`knock > 250 px/s`) dazes past 15% (`P.dazeSlow > 0`), or fast glancing Hip Clip spins a skater.',
          visual: 'Dual-team collision sparks, rotating `#c3cbff` dizzy spiral above the dazed skater, and glancing spin-out curve.',
          soundLabel: 'Play check chirp',
          variants: [
            { id: 'daze', label: 'Heavy Check + Daze Swirl' },
            { id: 'hip-clip', label: 'Glancing Hip Clip Spin-Out' }
          ],
          duration: 2.5,
          playSound: ctx => ctx.audio()?.playCollision(ctx.voice(), { volume: 0.9 }),
          run: (ctx, variant = 'daze') => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(6, 500, 110);
            if (variant === 'hip-clip') {
              ctx.place(0, 330, 290, { vx: 620, vy: 0 });
              ctx.place(3, 470, 326, { vx: -260, vy: 0 });
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
          title: 'Point-Blank Spin Strike (`"Spin strike!"`)',
          when: 'Skater launched with spin touches the ball first within 2 ball diameters (`tick.struck`, `playSpinStrike`).',
          visual: 'Tight cord-whoosh into sharp supersonic whipcrack, tapered counter-rotating spin blades on the ball, extra shot speed + Magnus curve, hit-stop, and `"Spin strike!"` callout.',
          soundLabel: 'Play whipcrack',
          duration: 2.5,
          playSound: ctx => {
            ctx.audio()?.playSpinStrike?.({ volume: 0.92, spin: 16 });
            ctx.audio()?.playBallHit({ volume: 0.9, snap: false });
          },
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(0, 380, 310);
            ctx.place(6, 434, 300);
            ctx.place(3, 780, 140);
            ctx.place(4, 780, 460);
            const plans = ctx.idlePlans();
            plans[0] = { angle: -0.14, power: 0.95, spin: 1.0, guard: false };
            ctx.launchPlans(plans);
          }
        },
        {
          id: 'snap-one-timer',
          title: 'Snap One-Timer Redirect (Team Colors)',
          when: 'Non-guarding skater (>=140 px/s) redirects a live teammate pass (>=180 px/s, `snapped = true`).',
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
          when: 'Body or ball hits rink boards above 220 px/s (`addWallEffect`, `handleWall`, `playWallHit`).',
          visual: 'Damped outward cosine bulge along `BOARD_RUNS`, tangent spark burst, and a restrained hollow hockey dasher-board thock.',
          soundLabel: 'Play board thock',
          duration: 2.2,
          playSound: ctx => ctx.audio()?.playWallHit({ volume: 0.78 }),
          run: ctx => {
            ctx.resetStage({ phase: 'play', mode: 'standard' });
            ctx.place(0, 380, 130, { vx: 220, vy: -580 });
            ctx.place(3, 620, 470, { vx: -200, vy: 580 });
            ctx.place(6, 500, 160, { vx: 180, vy: -620, pace: 620 });
          }
        },
        {
          id: 'post-ping',
          title: 'Goalpost Ring, Flash Ping & Post English',
          when: 'Fast spinning shot strikes a goalpost (`wallType === "post"`, >=300 px/s triggers 40ms hit-stop).',
          visual: 'Expanding post flash ring (`pings`), 8 gold/white metallic sparks (`#ffd76b`), 40ms hit-stop + shake, and 1.45x Post English bite.',
          soundLabel: 'Play post ring',
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
          title: 'Goal Net Mesh Ripple',
          when: 'Ball or skater hits the exterior/back goal net (`wallType === "net"`).',
          visual: 'Team-colored outward ripple along `NET_RUNS` + contact sparks.',
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
          title: 'Ball Heat Stages, Fireball, Ice Burn & Meteor Bank',
          when: 'Ball pace crosses 540 (orange) -> 720 (red + sparks) -> 800 (red-hot) -> 840+ on fire (`sparkBall`, `burnIce`).',
          visual: 'Glowing heated ball, ember sparks, additive flames, team-colored ball face, scorched ice burn ribbon, elastic Meteor Bank, and goal threat glow.',
          soundLabel: 'Play fire sizzle (1.5s)',
          variants: [
            { id: 'fire', label: 'Full Fireball + Meteor Bank' },
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
          title: 'Flaming Ball Impacts: Plow & Hot Shot Explosive Woosh',
          when: 'Flaming ball strikes a skater, boards, or defender (`plow = true`, `HOT_DRIVE`, `playFireImpact`).',
          visual: '15-particle flame scatter + firestarting explosive woosh (a compact cousin of Cannonball) on every flaming ball impact or Meteor Bank.',
          soundLabel: 'Play fire impact woosh',
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
      summary: 'Goal-line interceptions, sheepish own-responsibility saves, metallic Iron Saves, and friendly Fireball Traps.',
      items: [
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
          when: 'Launching with Stalwart (`launch`) and absorbing checks or shots (`impact`).',
          visual: 'Gold & indigo aura (`#ffd166` / `#4f5fc2`), 3x braking slide to immovable anchor, golden burst + 36 px shockwave on impact.',
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
          title: '01 · Knockout (Heavyweight POW & Stunned State)',
          when: 'Touching an opposing skater while Knockout is active (`handleSuper("knockout", "impact")`).',
          visual: 'Crimson & pink aura (`#ee2b47` / `#ff7197`), heavyweight arcade POW punch, crimson impact burst, and target dimmed with `💫` stun stars.',
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
          title: '02 · Sticky (Goop Splat Grab & Emerald Tether)',
          when: 'Touching the ball with Sticky active (`handleSuper("sticky", "impact")`, `drawStickyTether`).',
          visual: 'Emerald aura (`#42c66b`), bouncy cartoon goop-splat & jelly bubble pops, and pulsing tangent energy bridge (`#44dd66` / `#d9ffe3`).',
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
          title: '03 · Cannonball (Explosive Blast & Instant Fireball)',
          when: 'Striking the ball with Cannonball active (`handleSuper("cannonball", "impact")`).',
          visual: 'Fiery red/orange aura, `#ff634d` blast burst + 48 px shockwave, `ballFlare = 1`, instant fireball ignition, and hit-stop + shake.',
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
          title: '04 · Magnet (Tractor Beam Pull)',
          when: 'Ball enters 190 px of an active Magnet skater (`handleSuper("magnet", "pull")`).',
          visual: 'Blue & red polarity aura (`#3388ff` / `#ff3344`) and dashed `#3388ffcc` tractor-beam tether bending the ball inward.',
          soundLabel: 'Play magnet beam',
          duration: 2.8,
          playSound: ctx => ctx.audio()?.playSuper('magnet', 'pull'),
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
          title: '05 · Colossus (1.8x Titan Growth & Thunderclap)',
          when: 'Launching with Colossus armed (`handleSuper("colossus", "launch")`).',
          visual: 'Golden titan aura (`#ffe043` / `#c8961e`), sky-splitting thunderclap & rolling giant rumble, and 1.8x size/mass bowling defenders aside.',
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
          title: '06 · Shockwave (Sonic Force-Repulsor & Blast Rings)',
          when: 'Opponent enters 170 px of an active Shockwave skater (`handleShockwave`).',
          visual: 'Rose & mulberry aura (`#ff7197` / `#9d467a`), twin concentric shockwave rings, vacuum pre-snap, sub-sonic boom & harmonic ring shimmer.',
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
          title: '07 · Ghost (Translucent Phase Shift)',
          when: 'Launching with Ghost armed (`handleSuper("ghost", "launch")`) to phase through opponents.',
          visual: 'Cyan & alabaster aura (`#33e0ff` / `#f8f6f2`) and 45%-opacity body skating straight through blockers to hit the ball.',
          soundLabel: 'Play ghost shimmer',
          duration: 2.6,
          playSound: ctx => ctx.audio()?.playSuper('ghost', 'launch'),
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
      summary: 'Goal light sweeps, peony & ring fireworks with crackle, all Goal Call banners, burning nets, fanfares, and slow-mo replay.',
      items: [
        {
          id: 'goal-celebration',
          title: 'Goal Light Sweep, Fireworks, Call Banner & Fanfare',
          when: 'Ball crosses a goal line (`celebrate`, `drawGoalSweep`, `drawGoalCall`, `playFanfare`, `playFirework`).',
          visual: '200ms hit-stop + double shake, sweeping light band, 9 peony/ring firework shells with stereo mortar pops & crackles, scorer double-ring & portrait call.',
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
          visual: 'Goal net catches fire (`burnNet`) with continuous additive flames along the mouth, posts, back frame, and ball alongside `"FIREBALL!"` call and fireworks.',
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
          when: 'Post-goal firework shells reach fuse zero (`explodeShell`, `crackle`, `playFirework`).',
          visual: 'Peony and ring firework bursts across the scoring half with synchronized stereo mortar pops, star-burst snaps, and sky crackles (fanfare omitted so pops are isolated).',
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
      ctx: canvas.getContext('2d'),
      badgeCanvas,
      badgeCtx: badgeCanvas.getContext('2d'),
      bodies: P.kickoff(),
      entries: [],
      mode: 'standard',
      portrait: false,
      anonymous: false,
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
      contactMeter: (a, b, spd) => awardContactMeter(a, b, spd),
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

    function awardContactMeter(a, b, speed) {
      if (phase !== 'play' || goalReplay) return;
      const tick = matchTicks + Math.round((elapsed + P.DT) / P.DT);
      const changed = ububallMatch.contactMeter(P, view.bodies, stats, a, b, speed, tick, ububallMatch.rule(view.mode, 'classic'));
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
      collide: (a, b, speed, impulse, plow = false, iron = false, checker = null, snapped = false, tangentImpulse = 0) =>
        presenter.handleCollision(a, b, speed, impulse, plow, iron, snapped, tangentImpulse),
      wall: (body, velocity, wallType, nx, ny, rimmed = false) =>
        presenter.handleWall(body, velocity, wallType, nx, ny, rimmed),
      shockwave: (source, radius, type = null) =>
        presenter.handleShockwave(source, radius, type),
      super: (key, stage, body, target = null) =>
        presenter.handleSuper(key, stage, body, target)
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
    let rafId = 0;
    let lastRaf = 0;
    function scheduleLoop() {
      if (!rafId && !paused && !doc.hidden) {
        lastRaf = 0;
        rafId = requestAnimationFrame(tickFrame);
      }
    }

    function resetStage({ phase: nextPhase = 'plan', mode = 'standard', glow = 0 } = {}) {
      draggingPlan = false;
      stopAllAudio();
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
      plans = turnPlans.map(p => ({ angle: 0, power: 0, spin: 0, guard: false, ...p }));
      phase = 'play';
      elapsed = 0;
      accumulator = 0;
      P.startTurn(view.bodies, plans, liveFx.super);
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
        if (phase === 'plan' && i === 0) launchPlans(plans);
        else stepSimulationTick();
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
      $('stage-telemetry').textContent =
        `${label} | ${phase.toUpperCase()} ${elapsed.toFixed(2)}s | Ball ${bSpeed} px/s (pace ${bPace}, heat ${heat}${fireTag}) | ` +
        `Particles ${fx.particles.length} · Waves ${fx.shockwaves.length} · Skids ${fx.skids.length} · Burns ${fx.burns.length}${stopTag}`;
    }

    const workbenchCtx = {
      P,
      ububallMatch,
      presenter,
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
      after: (sec, fn) => timedCallbacks.push({ at: sec, fn }),
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
    canvas.addEventListener('pointerdown', e => {
      const p = rinkPoint(e);
      const warn = presenter.warningAt(p, fouls);
      if (warn) { openFoulInfo(warn); return; }
      if (phase !== 'plan') return;
      const idx = view.bodies.slice(0, 3).findIndex(b => Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 18);
      if (idx >= 0) {
        selected = idx;
        draggingPlan = true;
        canvas.setPointerCapture(e.pointerId);
        draw();
      } else {
        const arrowIdx = view.bodies.slice(0, 3).findIndex((b, i) => {
          const g = impulseGeometry(P, b, plans[i]);
          return g.visible && Math.hypot(g.x - p.x, g.y - p.y) < 28;
        });
        if (arrowIdx >= 0) {
          selected = arrowIdx;
          draggingPlan = true;
          canvas.setPointerCapture(e.pointerId);
        }
      }
    });
    canvas.addEventListener('pointermove', e => {
      if (!draggingPlan || phase !== 'plan') return;
      const p = rinkPoint(e), b = view.bodies[selected];
      const dx = p.x - b.x, dy = p.y - b.y, dist = Math.hypot(dx, dy);
      const geom = impulseGeometry(P, b, { angle: 0, power: 1 });
      plans[selected].angle = Math.atan2(dy, dx);
      plans[selected].power = Math.max(0, Math.min(1, (dist - geom.ringR) / Math.max(1, geom.scale)));
      plans[selected].guard = false;
      presenter.dirtyPrediction();
      draw();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      canvas.addEventListener(ev, () => { draggingPlan = false; });
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
      if (phase !== 'plan' || postGoal || goalReplay || timedCallbacks.length) return true;
      if (fx.kickoffGlow > 0 || fx.particles.length || fx.shockwaves.length || fx.skids.length || fx.burns.length || fx.pings?.length || fx.popups?.length) return true;
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

        presenter.updatePopups(rawDt * speedMultiplier);
        presenter.updateEffects(simDt);

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

    return { workbenchCtx, runDemo };
  }

  const exported = { EFFECT_GROUPS, GOAL_CALL_VARIANTS, bootBrowserWorkbench };
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else {
    root.ububallEffectsDemo = exported;
    bootBrowserWorkbench();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
