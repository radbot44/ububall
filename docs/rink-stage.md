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

All 7 phases (Phases 1–7) are built and complete.

Working now (`web/index.html`, `web/app.js`, `web/site-header.js`, `web/ububall-activity.js`,
`web/site.js`, `web/site.css`, `web/pack-scene.js`, `web/ubu-list.js`,
`web/ububall-presentation.js`, `web/ububall.js`, `web/ububall.css`, `web/effects.html`,
`web/effects.css`, `web/effects.js`, `shared/ubu-audio.js`):

- `.arena-layout` lives in the shared `.ball-page` shell across Play, Ubu Mint and Collection;
  `app.js` routes screen switches through `setUbuScreenTransition` (preserving Discord Activity
  launch query parameters when embedded) so `setShot(name)` (`home`, `lobby`, `rules`, `team`,
  `match`, `replay`, `mint`, `collection`) drives all three screens on one persistent rink stage.
- `#roster-dialog` is a plain docked `.team-sheet` `<section>` (not a `<dialog>`) that slides over
  the away half on wide screens and stacks below the landscape rink on phones, while `#roster-slots`
  (`.roster-slots`) lives permanently inside `.rink-stage` with `.formation-slot` cards over your
  three kickoff positions (`Back`, `Top`, `Bottom`). All legacy modal setup fallbacks (`canDock`,
  `sheetDocked`, `showModal`) and CSS half-rink `.formation` rules are removed.
- `.site-header` is styled as the arena's overhead scoreboard strip: a 3-zone beveled slate gantry
  with Saffron home and Amethyst away end-caps and a recessed centre tab bay over the rink on
  landscape screens, pairing with a compact top strip and docked bottom `.site-nav` bar on portrait
  phones.
- Phones (portrait and short/narrow landscape, standalone and Discord Activity) use stacked variants
  across every shot on the persistent stage and cut cleanly between shots (`compactPhoneStage()`),
  preserving isolated portrait-play orientation (`match` and `replay`) and full touch aiming/overlay
  geometry.
- `web/effects.html` (`EFFECT_GROUPS` in `web/effects.js`) includes **`9. Stage & Mint`** covering
  `castTo` scatter & return, Choose Team `skateLineup` arrival & departure, and Ubu Mint spotlight
  reveal & scamper alongside all `playPack` sound effects.

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
8. **Navigation** stays at the top, styled as an arena scoreboard strip with Saffron/Amethyst end-caps and a recessed centre tab bay (portrait phones keep the compact top strip and bottom tab bar; confirmed 2026-11-12).
9. **Scatter and lineup arrival** (confirmed 2026-11-12). Cast scatter flies each ubu and the ball straight out radially from centre ice with staggered spin (`castTo`); the Choose Team lineup skates in from the home goal into `.roster-slots` kickoff position cards (`Back`, `Top`, `Bottom`) over the real kickoff spots.
10. **Effects catalog** (confirmed 2026-11-12). Stage cast scatter/return, lineup skate-in/out and Ubu Mint spotlight/scamper choreography live in a 9th `EFFECT_GROUPS` section (`9. Stage & Mint`) in `web/effects.html`.

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

None.

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
- 2026-11-12: Phase 5 built (Discord Activity `lobby` shot, docked Activity `rules`/`team` setup,
  and Activity Mint & Collection). Added `lobby` shot (`web/ububall-activity.js`, `web/ububall.js`,
  `web/ububall.css`) placing the landscape demo/paused-CPU rink beside the 4-per-row Activity lobby,
  team card and compact Mint bar on desktop (stacked below the rink on portrait and short landscape
  phones); enabled docked `rules` and `team` setup with `.formation.on-ice` inside the Activity on
  wide screens (`canDock`), clean `returnShot = 'lobby'`, `prepareOnline()` setup teardown,
  `enterMatch()` cast restoration when matches start from `mint`/`collection`, and resumable CPU
  play (`Back to lobby` / `Resume CPU`); integrated Activity Mint & Collection (`bootMint()` awaiting
  `ubuActivity.signIn()`, non-reloading `#mint-retry`, preserved Discord query params in `app.js`,
  3-column portrait `.site-nav`, safe-area insets on `.site-header`/`#collection-dock`/`.viewer.on-ice`,
  and `overflow-x: clip` on `collection` so scattered skaters never add a horizontal scrollbar);
  added Phase 5 unit tests in `test/ububall-effects.test.js` and verified desktop and mobile Activity
  flows in headless Chromium.
- 2026-11-12: Phase 6 built (Phones: stacked variants of every shot and portrait play check).
  Enabled `#roster-dialog.docked` and `.formation.on-ice` on phones (`canDock` in `web/ububall.js`)
  with stacked rink-over-panel `rules`/`team` layouts and compact non-overlapping kickoff cards in
  `web/ububall.css`, keeping setup open across `wideScreen` rotation/resize; updated
  `compactPhoneStage()` and `camera()` so portrait and short/narrow landscape phones cut directly
  between all shots without FLIP or Collection rotate steps; capped short-landscape rink height on
  `home`, `lobby` and `mint` (preserving full scoreboard width and fitting `mint` deal/reveal inside
  `<= 600px` height); clipped `html:has(body[data-shot="collection"])` scatter overflow and gave
  phone `.viewer.on-ice` full-width portrait / full-height short-landscape framing (`web/site.css`);
  separated `setPortrait` from `toggleRotate` orientation persistence so `.portrait-mode` never
  leaks onto non-match shots or across screen orientations, compacted short-portrait `.scoreboard` /
  `.stadium-actions` and phone `#replay-bar`, added Phase 6 unit tests in
  `test/ububall-effects.test.js`, and verified all 8 shots plus portrait play in headless Chromium.
- 2026-11-12: Applied owner mobile review polish on Phase 6 (`web/ububall.js`, `web/ububall.css`,
  `web/site.css`): hid outer `.site-header` and `.site-nav` during stacked mobile `rules`/`team`
  setup to reclaim vertical picker height, widened the setup rink to full width with 3-row
  non-overlapping `Top`/`Bottom` on-ice cards and wider `Back` slot, gated the desktop drag hint in
  `teamHint()` on `!compactPhoneStage()`, unstuck `.roster-toolbar` and scaled mobile `.roster-grid`
  to 3 columns; removed side gutters on mobile `collection` (full-width `#collection-dock` and
  board-aligned `.rink-stage`) and scaled `.collection-ice .ubu-grid` to 3 ubus per row on portrait
  phones; verified on Chrome DevTools iPhone SE (`375×667`, DPR 2) and unit tests.
- 2026-11-12: Compacted ubu tiles and list controls across desktop and mobile (`web/index.html`,
  `web/ubu-list.js`, `web/ububall.js`, `web/site.css`, `web/ububall.css`): removed `.ubu-tile-badge`
  and single-line-clamped `.ubu-tile-name` plus adjective-truncating `.ubu-tile-archetype`
  (`.ubu-tile-adj` + `.ubu-tile-noun`) across all screen sizes; hid `.ubu-tile-meta` (`Grade #serial`)
  on small screens; moved numeric sort values (`chipValue` without label prefix) into a bottom-right
  overlay on `.ubu-tile-art`; removed routine `#roster-hint` copy and switched to Tabler `#icon-filter-2`, keeping sort/direction/favorites inline on one row on large
  screens (`>= 56rem` landscape) and tucking them into the `#icon-filter-2` dropdown on compact
  screens so Change Team controls stay at 3 rows everywhere.
- 2026-11-12: Phase 7 built (Cleanup: dead layout CSS and dialog code removed, `9. Stage & Mint`
  effects catalog added, scoreboard-strip `.site-header` pass). Converted `#roster-dialog` from
  `<dialog>` to a plain docked `<section class="team-sheet">` (`sheetOpen` / `openSheet` /
  `closeSheet` / `cancelSheet`), mounted `#roster-slots` (`.roster-slots`) permanently inside
  `.rink-stage`, and deleted `canDock`, `sheetDocked`, modal `.team-sheet` / `.formation` half-rink
  CSS, legacy `#signed-out-panel` `main:has(...)` rules, `.online-options`, `.pack-fallback`,
  `.super-arm-btn`/`.super-picker-btn` and dead header/fallback selectors across `web/index.html`,
  `web/ububall.js`, `web/ububall.css`, `web/site.css`, `web/site.js` and `web/site-header.js`;
  styled `.site-header` as a 3-zone broadcast scoreboard strip with Saffron/Amethyst team end-caps
  and a recessed centre tab bay; added Group `9. Stage & Mint` (`stage-cast-scatter`,
  `stage-lineup-arrival`, `stage-mint-scamper` + `playPack` audio) to `web/effects.html`,
  `web/effects.css` and `web/effects.js`; updated unit tests in `test/ububall-effects.test.js` and
  verified across desktop and mobile in headless Chromium.
- 2026-11-12: Fixed Ubu Mint entry border flash in `web/ububall.css` by setting
  `border: 0 none transparent;` on `.stadium-stage-area` (and `collection` `.stadium`/`.stadium-stage-area`)
  so entering `mint` no longer interpolates `border-color` from `currentcolor` to `transparent`.
- 2026-11-12: Fixed mobile Choose Team `TOP`/`BOTTOM` ubu clipping in `web/ububall.css` by changing
  `.roster-slots .formation-slot:not([data-position="back"]) .formation-pick` from `overflow: hidden;`
  to `overflow: visible;` so `.formation-art` (`translate: 0 .5rem;` when `.formation-super` is shown)
  is not sliced off while `.formation-name` retains name ellipsis truncation.
- 2026-11-12: Fixed seamless Collection exit transitions across all scroll positions (`web/ububall.js`,
  `web/ububall.css`, `web/app.js`, `web/site.css`, `web/site.js`, `test/ububall-effects.test.js`):
  forced `display: block` and `margin-bottom: 0` on `.rink-stage.collection-shrinking` (hiding
  target-shot in-stage overlays until shrink finishes) so flex centering never pushes `#rink` below
  the viewport; preserved exact scrolled `stageTop` and `viewTop` instead of snapping to `64px` / `0`,
  retracting deep scrolls smoothly (with `2 * step` period reduction) to a viewport-covering `3:5`
  pose before rotating back; moved `scrollTo(0, 0)` into `app.js`'s `applyDom` (covering `popstate`
  and measuring target shots at `scrollY = 0`); elevated `.site-header` `z-index` above `.camera-moving`
  and clipped transient `.camera-moving` page scrollbars.
- 2026-11-12: Fixed clipped Ubu Mint pack-opening animations on the rink stage (`web/site.css`,
  `web/pack-scene.js`, `web/site.js`, `test/ububall-effects.test.js`): expanded `.mint-world
  .candy-pack canvas` (`left: -50%; top: -85%; width: 200%; height: 280%; pointer-events: none;`)
  outside the `.candy-pack` hit box so flying caps, domes, shards, flaps, tear strips and fanned
  silhouettes render unclipped onto the rink while keeping button click targets, hover glows and
  `#home-pack` unchanged; updated `createPackScene` (`paint` and `pointermove`) and
  `capturePackEmergence` to align coordinates and scale against the parent `.candy-pack` button.
