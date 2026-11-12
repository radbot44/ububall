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

Slice 1 is built and awaiting the owner's review of the feel. Not committed.

Working now, on a wide desktop screen outside a match (`web/ububall.js`, `web/ububall.css`):

- `camera(change)` glides the rink between the home, setup and match layouts.
- `castTo(away)` skates whoever is on the ice off and back; the game's bodies are restored exactly.
- New match and Change team open the setup shot: the rink grows to game size, the team sheet docks
  over the away half (`.team-sheet.docked`, a non-modal `<dialog>`), and the lineup stands on the
  ice as position buttons (`.formation.on-ice`). Rules and team are two steps of the same sheet.
- Start match hands over to the match layout with the new ubus where the lineup stood. Close or
  Escape returns to home and the cast skates back.

Not done or not checked:

- The sheet is still the old modal, with the drawn `.formation`, on phones, in the Discord Activity
  and when opened during a match (pause → New match, Change rules, after full time).
- Layout states were checked in the browser at 1024×768 and 1440×900; the moves themselves were
  not watched in motion. The docked online lobby and a signed-in collection were not exercised
  (local dev has no session).
- Scatter and arrival are not in `web/effects.html` yet.

Next step: owner feedback on slice 1, then phase 2.

## Decisions (owner, 2026-11-11)

1. **Flat only.** The rink stays top-down. Camera moves are translate, scale and in-plane rotation.
   No perspective tilt, no WebGL.
2. **Ubu Mint is a lit stage.** The rink's lighting changes: the ice goes dark and spotlights pick
   out each pack, which sit on the rink.
3. **Collection is a stretched portrait rink.** Opening it rotates the rink to portrait and then
   grows it in height to hold the collection rows; the ubu grid lives on the ice. Leaving shrinks
   it first, then rotates back.
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
- `fitStadium()` in `web/ububall.js` sizes the rink; the `in-match` body class switches between the
  home layout and the match layout in `web/ububall.css` with no transition. Portrait play is a CSS
  `rotate(-90deg)` on `.rink-wrap`.
- Team and rules are the modal `#roster-dialog`; `.formation` is a CSS drawing of half a rink.
- The demo (`startDemo`/`stopDemo`) runs only on `/` outside a match and is disposed on other
  screens. `theater` is the replay viewer's session.
- Mint packs are DOM buttons with their own canvases (`web/pack-scene.js`); Collection is the
  `#ubus` grid from `web/ubu-list.js` and `web/site.js`, loaded lazily.

## Design (*proposal*)

### Stage
Move the stadium out of the Play block into one persistent layer that all three screens share.
`app.js` keeps routing by path but stops hiding the rink; a screen change becomes a shot change.
Slice 1 did not need this (all its shots are on Play); it is the first job of phases 3 and 4.

### Camera (as built)
Each shot's layout is ordinary CSS, switched by a body class (`setup-shot`, `in-match`). `camera()`
measures the rink stage's box, applies the change, measures again and plays the stage from the old
box to the new one with one transform animation. New shots therefore need only CSS plus a
`camera()` call around the class change. Portrait play and reduced motion cut. In-plane rotation is
not built yet; Collection needs it.

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
- Whether the demo keeps simulating under the Mint and Collection shots or freezes to save CPU.
- Where opened ubus go after a pack reveal on the Mint stage.

## Log

- 2026-11-11: Plan written from the owner's brief and answers. No code changed.
- 2026-11-11: Slice 1 built (camera, cast, setup shot, lineup on the ice). `npm test` passes.
  Scatter is each ubu flying straight out from centre ice with a spin; the lineup skates in from
  the home goal. Dev note: `npm run dev` serves `dist/public`, so rerun
  `node scripts/prepare-assets.cjs` after editing `web/` and reload.
