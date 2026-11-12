# Rink stage

Working plan for making the rink the centre of the whole interface. This is the handoff document:
update the Status and Log sections whenever work lands, and move anything the owner decides from
Open points into Decisions. Sections marked *proposal* are agent recommendations, not owner
decisions (see AGENTS.md).

## Goal

The rink never leaves the screen. Play, Ubu Mint and Collection, and every menu inside them, are
different views of the same rink: it slides, resizes and rotates in plane, and buttons and panels
slide in and out around it, like moving through the menus of a video game. Whatever is on the ice
(demo, CPU match, online match, replay) keeps working through all of it.

## Status

Phase 4 is built and awaiting the owner's review (Phases 2–3 built).

Working now (`web/index.html`, `web/app.js`, `web/site.js`, `web/site.css`, `web/pack-scene.js`,
`web/ubu-list.js`, `web/ububall-presentation.js`, `web/ububall.js`, `web/ububall.css`,
`shared/ubu-audio.js`):

- `.arena-layout` lives in the shared `.ball-page` shell across Play, Ubu Mint and Collection;
  `app.js` routes screen switches through `setUbuScreenTransition` so `setShot(name)` (`home`,
  `rules`, `team`, `match`, `replay`, `mint`, `collection`) drives all three screens on one
  persistent rink stage.
- Entering `collection` on desktop scatters whoever is on the ice (`castTo(true)`), rotates the
  rink `-90deg` in-plane into a portrait `3:5` pose matching Ubu Mint's `min(114rem, calc(100% - 3rem))`
  width, and then stretches the rink in height (`drawPortraitRinkSurface`) to hold the collection
  rows while keeping at least the regulation `3:5` portrait height. Leaving shrinks the stretched
  rink back to `3:5` first and then rotates `+90deg` back into the target landscape shot (`home`,
  `mint`, or directly into `team` for `/?roster=1`). Phones and `prefers-reduced-motion` skip the
  rotation/stretch animations cleanly.
- `#rink` renders as a sticky viewport-sized portrait window inside `.rink-stage` so collections of
  any size stay crisp at native DPR without oversized canvas buffers; top (Away) and bottom (Home)
  goals and creases frame the ends while dashed zone/centre lines and centre-ice face-off circles +
  Ububall logos repeat at regular `320`/`640`-unit intervals as you scroll.
- `#collection-dock` (`Your ubus`, `Open .ubu`, `Play with my ubus` and `#collection-toolbar`) sits
  outside above the top goal and sticks to the top of the viewport while scrolling; `#ubus` lives
  directly on the ice inside `#collection-world`.
- Selecting an ubu in Collection scatters neighbouring tiles outward across the ice and grows the
  chosen ubu from its tile into a stage-integrated `.viewer.on-ice` panel over a colour-matched ice
  halo, preserving all four tabs (`Ubu Stats`, `Card`, `Token`, `Sound`), Favorite, `Download .ubu`,
  Prev/Next collection stepping and Escape/outside-ice close (gathering tiles back onto the ice),
  while `window.showUbuViewer` from Choose Team continues opening `#viewer` as a modal.
- Ubu Mint spotlights, pack unwrap, silhouette emergence, zoomed card reveal, aiming input, docked
  desktop `rules`/`team` setup, pause/stats/summary modals, replays and CPU leave/resume from
  Phases 1–3 continue working unchanged.

Not done or not checked:

- The team sheet stays a modal, with the drawn `.formation`, on phones and in the Discord Activity
  (phases 5 and 6); Activity Mint and Collection layout check is Phase 5.
- Scatter, arrival and Mint scamper are not in `web/effects.html` yet (phase 7).

Next step: Phase 5 (Discord Activity: lobby shot, Mint and Collection inside the Activity).

## Decisions (owner, 2026-11-11)

1. **Flat only.** The rink stays top-down. Camera moves are translate, scale and in-plane rotation.
   No perspective tilt, no WebGL.
2. **Ubu Mint is a lit stage** (updated 2026-11-12). The header and Mint title stay outside the
   rink. Entering Ubu Mint scatters all skaters off the rink (pausing the demo) as the ice goes
   dark with spotlights picking out each pack. Clicking a pack swipes the other packs away, glides
   the chosen pack and its spotlight to centre ice and opens it; the five ubus inside (three for a
   daily or signup pack) appear silhouetted under spotlights, and the camera zooms to the first ubu
   to reveal its card with Prev/Next arrows (the active ubu shows its trading card while neighbours
   appear as ubus off to the side — silhouetted until seen, full colour once seen). Pressing Done
   zooms back out, scampers all the ubus away and fades the next packs into position. Clicking the
   Home screen's Signup bonus pack navigates to Ubu Mint and opens after the transition.
3. **Collection is a stretched portrait rink** (updated 2026-11-12). Opening it rotates the rink
   to portrait at about the same width as the Ubu Mint rink (`min(114rem, calc(100% - 3rem))` on
   desktop) and then grows it in height to hold the collection rows (minimum `3:5` portrait height);
   leaving shrinks it back to `3:5` first, then rotates back. Zone/centre lines and the centre-ice
   face-off circle + logo repeat at regular intervals down the ice as you scroll. The Collection
   header/actions and search/sort/filter toolbar sit outside above the top goal and stay sticky on
   scroll, while the ubu grid lives on the ice. Selecting an ubu scatters the other ubus away and
   grows the chosen ubu into an on-ice viewer panel with the full stats, card, token and sound
   views.
4. **Live games.** A CPU match can be left for the home screen and returned to, as now. An online
   match still cannot be left without the forfeit confirmation.
5. **Choose team.** The rink goes to game size. Your three ubus stand at their kickoff positions,
   each wrapped in a button that labels the position (Back, Top, Bottom) and works as the formation
   slots do now. Collection, search, filters and the game settings are a panel on the right, which
   covers the opponent's half; opponent ubus are hidden behind it. The ubus that were playing
   (demo or real) scatter away before yours arrive.
6. **Phones.** Agent's call; the site must work on phones. Phones may skip the camera moves.
7. **Discord Activity** stays level with the site, including working Mint and Collection. It uses
   the same stage with its own layout (lobby beside the rink, see AGENTS.md).
8. **Navigation** stays at the top. Styling it to look part of the scene is welcome, not required.

## Invariants

- Physics, match rules, recordings, replay files and the online protocol do not change. Scatter,
  arrival, lighting and camera moves are presentation only and never touch simulation bodies.
- The rink accepts aiming input only when the camera is at rest in a playable shot. Aiming, the
  spin control, the first-turn guide and foul boxes all measure the rink's on-screen box
  (`measureField`, `stagePoint` in `web/ububall.js`); re-measure when a move ends.
- Video export, share cards and the stats map draw through their own view (`fieldView` swap,
  `view.field`) and must stay independent of the on-screen camera.
- AGENTS.md still applies: custom game UI only, overlays never push content, four choices per row
  (ubu grids exempt), plain JavaScript, no new dependency. New visual effects are added to
  `web/effects.html` and `EFFECT_GROUPS`.
- Prerelease: replace the old layouts outright. No compatibility paths or duplicate old/new menus.

## How it is built today

- `web/app.js` shows one of three `<main data-screen>` blocks by path. The rink exists only inside
  the Play block (`.arena-layout > .stadium > .rink-stage > .rink-wrap > #rink`).
- `fitStadium()` in `web/ububall.js` sizes the rink; `body[data-shot]` switches between the `home`,
  `rules`, `team`, `match` and `replay` layouts in `web/ububall.css` via `setShot(name)`. Portrait
  play is a CSS `rotate(-90deg)` on `.rink-wrap`.
- On wide desktop screens, `#roster-dialog` docks over the away half in `rules` and `team` shots
  with `.formation.on-ice`; on phones and in the Discord Activity it remains a modal with the CSS
  `.formation` drawing until phases 5–7.
- The demo (`startDemo`/`stopDemo`) runs only on `/` in `home` when no match is in progress and is
  disposed on other screens. `theater` is the replay viewer's session.
- Mint packs are DOM buttons with their own canvases (`web/pack-scene.js`); Collection is the
  `#ubus` grid from `web/ubu-list.js` and `web/site.js`, loaded lazily.

## Design (*proposal*)

### Stage
Move the stadium out of the Play block into one persistent layer that all three screens share.
`app.js` keeps routing by path but stops hiding the rink; a screen change becomes a shot change.
Phases 1 and 2 did not need this (all their shots are on Play); it is the first job of phases 3
and 4.

### Camera (as built)
Each shot's layout is ordinary CSS, switched by `body[data-shot]` (`home`, `rules`, `team`, `match`,
`replay`) via `setShot(name)`. `camera()` measures the rink stage's box, applies the change,
measures again and plays the stage from the old box to the new one with one transform animation,
marking `cameraMove` until `onfinish` and then re-measuring field geometry and stage overlays. New
shots therefore need only CSS plus a `setShot()` pose. Portrait play and reduced motion cut.
In-plane rotation is not built yet; Collection needs it.

### Shots
A shot is a named pose plus the panels that belong to it:

| Shot | Rink | Around it |
| --- | --- | --- |
| `home` | landscape, left | play buttons and team on the right |
| `team` | landscape, game size | team panel over the away half; position buttons on your ubus |
| `rules` | as `team` | rules and CPU level in the same panel |
| `match` | game size, landscape or portrait | scorebug, sidebars, controls |
| `replay` | as `match` | replay bar |
| `mint` | landscape, centred, dark | packs under spotlights |
| `collection` | portrait, stretched | grid on the ice, toolbar docked |
| `lobby` (Activity) | landscape | lobby cards beside the rink |

One `setShot(name)` owns the move. It sets the pose as CSS custom properties on the stage
(position, scale, rotation, length), lets CSS transitions run it as a transform, marks the stage
busy until `transitionend`, then re-rasterises the canvas at the new size and re-measures. Panels
key their slide-in off the shot name. `prefers-reduced-motion` gets cuts. Ordered moves (Collection:
rotate then grow; reverse on the way out) are two chained steps of the same function.

### Cast
What stands on the ice is separate from which match is running: `demo`, `match`, `replay` or
`lineup` (your three ubus at kickoff spots, no simulation). Changing cast plays a cosmetic exit
(scatter off the ice) and entrance (skate to spots) on the displayed bodies. A CPU match that is
left keeps its state exactly as now and returns as the cast when resumed.

### Team panel
`#roster-dialog` becomes a docked panel, not a `<dialog>`. `.formation` is deleted; its slots become
buttons positioned over the real ubus through `stagePoint`. Drag and drop, super choice and saved
teams keep their behaviour.

### Mint lighting
A lighting layer over the rink canvas: a dark wash with a soft pool per pack, positioned from each
pack's place on the ice. The packs keep their own canvases and sit above the layer.

### Collection rink
The rink frame (boards, ice, rounded ends, a goal at each end) is drawn at a variable length so it
can grow to the height of the grid and scroll with the page. Play markings fade out as it grows.
Draw this with a length parameter in the presentation layer; physics constants in `P.rink` are
untouched.

### Phones (agent's decision)
Portrait phones and short landscape phones use the same stage and casts with a stacked layout: rink
on top, panel below. They cut or fade between shots and skip the rotations. Collection on a phone
is the stretched rink without the rotate step.

### Navigation
The tabs stay in the header. Optional later pass: style the header as the rink's scoreboard strip
so it reads as part of the arena.

## Phases

1. **Slice: Home → Choose team → Rules → Kickoff** on desktop. Stage layer, `setShot`, the `lineup`
   cast with scatter and arrival, team panel docked right. Owner reviews the feel before more is
   converted.
2. **Match and replay shots.** Fold `in-match` and `replay-match` layouts into shots; pause, stats
   and summary keep working; leaving and resuming a CPU match.
3. **Ubu Mint.** Stage lighting, packs on the ice, pack reveal.
4. **Collection.** Rotate and stretch, grid on the ice, viewer.
5. **Discord Activity.** Lobby shot, Mint and Collection inside the Activity.
6. **Phones.** Stacked variants of every shot; check portrait play.
7. **Cleanup.** Remove dead layout CSS and dialog code; effects catalog; header styling pass.

## Open points

- Exact look of the position buttons around the ubus in the team shot.
- What scatter looks like (skate off through the goals, over the boards, fade).

## Log

- 2026-11-11: Plan written from the owner's brief and answers. No code changed.
- 2026-11-11: Slice 1 built (camera, cast, setup shot, lineup on the ice). `npm test` passes.
  Scatter is each ubu flying straight out from centre ice with a spin; the lineup skates in from
  the home goal. Dev note: `npm run dev` serves `dist/public`, so rerun
  `node scripts/prepare-assets.cjs` after editing `web/` and reload.
- 2026-11-11: Phase 2 built. Replaced `in-match`, `replay-match` and `setup-shot` body classes
  with `setShot(name)` (`body[data-shot]`: `home`, `rules`, `team`, `match`, `replay`) across
  `web/index.html`, `web/site.js`, `web/ububall.css` and `web/ububall.js`. Gated aiming input and
  stage overlays (`#field-spin`, `#first-turn-guide`, `.foul-info`) until `cameraMove` finishes;
  enabled docked `rules`/`team` shots from `match` and `replay` (Pause → New match, Change rules,
  Full time → New match, online rematch lobby) with `returnShot` / portrait restoration on cancel;
  prevented premature `enterMatch` while an online room is still in `lobby`; stopped fanfare/motion
  audio and preserved CPU match state across Leave → Home → Resume; added Phase 2 unit tests in
  `test/ububall-effects.test.js`.
- 2026-11-11: Fixed layout jump on closing Choose Team / camera move: `.stadium-stage-area` has
  `min-width: 0; min-height: 0;` so `.stadium.camera-moving`'s `overflow: visible` does not trigger
  CSS flexbox auto-minimum expansion to `.rink-stage`'s 5:3 content height during transitions,
  keeping the home shot's 1000:540 stage ratio and vertically-centered `.play-home` sidebar rock-solid.
- 2026-11-12: Phase 3 built (Ubu Mint on the persistent stage). Moved `.arena-layout` into the
  shared `.ball-page` shell across Play and Mint (`web/index.html`, `web/app.js`, `web/ububall.js`,
  `web/ububall.css`) with atomic FLIP screen transitions (`setUbuScreenTransition`, `ubuStageReady`),
  skater scatter (`castTo(true)`) and paused demo on `mint`; replaced `<dialog id="reveal">` with
  `#mint-world`, `#mint-lights`, `#mint-ubus` and `#mint-reveal` (`web/site.js`, `web/site.css`,
  `web/pack-scene.js`, `shared/ubu-audio.js`) for pack spotlights, swipe-and-centre opening,
  5/3-spotlight silhouettes, zoomed card-and-neighbour reveal panning, scamper exit, fade-in
  re-deal and Home `#home-pack` handoff to `/mint`; added Phase 3 unit tests in
  `test/ububall-effects.test.js` and `test/ubu-audio.test.js` and verified desktop/mobile frames in
  headless Chromium.
- 2026-11-12: Applied owner review polish on Phase 3: scaled `mint` `.ball-page` and `.rink-stage`
  up to match Play's full `114rem` content width; updated mobile `< 48rem` reveal to overlay
  `.card-stage` over the spotlit rink with single-row controls directly underneath (no vertical
  scroll) plus touch swipe navigation across cards; eliminated the silhouette fade-out/re-appear by
  keeping `pack-scene.js` silhouettes solid through `t = 1` and animating `.mint-ubu` directly from
  `getSilhouetteTokens()` / `capturePackEmergence()` into the lineup as one continuous motion.
- 2026-11-12: Phase 4 built (Collection on the persistent portrait rink). Moved
  `<main data-screen="collection">` into `.ball-page` with sticky `#collection-dock` above the top
  goal and `#collection-world` / `#collection-viewer-stage` inside `.rink-stage` (`web/index.html`,
  `web/ububall.css`, `web/site.css`); added `drawPortraitRinkSurface` (`web/ububall-presentation.js`)
  with `3:5` minimum height (`L >= 1000`), top/bottom goals and creases, viewport-windowed sticky
  canvas rendering and regularly repeating `320`/`640`-unit lines and centre-ice circles + logos on
  scroll; added chained two-step `rotate → stretch` and `shrink → rotate` camera moves in
  `web/ububall.js` (with phone/reduced-motion cuts and direct `/?roster=1` handoff); built the
  hybrid rink-and-panel `.viewer.on-ice` in `web/site.js` and `web/ubu-list.js` with radial tile
  scatter, FLIP panel growth, colour-matched ice halo, Prev/Next collection stepping and modal
  fallback for Choose Team inspect; added Phase 4 unit tests in `test/ububall-effects.test.js` and
  verified desktop and mobile frames in headless Chromium.
