# Rink stage — current design contract

The rink remains the common stage for Play, Ubu Mint, Collection and their menus. This document holds approved decisions, current implementation and invariants, **not** a running plan. The completed seven-phase plan, proposals and chronological log are preserved in [the implementation archive](archive/rink-stage-implementation-2026-11.md).

## Goal

The rink never leaves the screen. Play, Ubu Mint and Collection, and every menu inside them, are
different views of the same rink: it slides, resizes and rotates in plane, and buttons and panels
slide in and out around it, like moving through the menus of a video game. Whatever is on the ice
(demo, CPU match, online match, replay) keeps working through all of it.

## Implemented state

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

1. **Flat only.** The rink stays top-down. Camera moves are translate, scale and in-plane rotation
   (no 3D perspective tilt). Live rink rendering uses 2D top-down WebGL2 (`web/ububall-webgl.js` +
   `web/ububall-presentation.js`) with automatic Canvas 2D fallback (updated 2026-11-15).
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

## Current implementation

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


## Historical context

Completed phases, superseded proposals, and the implementation log: [November 2026 rink-stage archive](archive/rink-stage-implementation-2026-11.md). The archive is not a source of active instructions.
