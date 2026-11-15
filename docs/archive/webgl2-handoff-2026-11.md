> Historical one-time WebGL2 migration handoff. Refer to current code, [README](../../README.md) and [rink-stage contract](../rink-stage.md) for the shipped renderer. Do not treat this handoff as current work authorization.

# Handoff: complete the ububall WebGL2 renderer migration

## Assignment

Carry the transition from the current Canvas 2D / DOM rink renderer to a production-ready WebGL2 rink renderer through implementation, integration, and validation as one sustained assignment. The owner wants a capable agent to handle the whole transition autonomously, rather than repeatedly proposing small next steps or requiring supervision at each phase. Internal iteration and measured verification are expected. A prototype alone does not complete the task.

Read `C:/dev/ububall/AGENTS.md` and `README.md` first. Read `docs/ububall.md`, `docs/rink-stage.md`, and the replay/online documentation before changing the corresponding integrations. Work in `C:/dev/ububall`. This handoff authorizes local implementation and testing; deployment, production configuration, and publishing remain separate owner actions. Do not create suggestion-audit log entries for this task.

## Intended result

Use WebGL2 for the live rink scene, including skaters and scene effects, while preserving gameplay, existing visual identity, interactions, replay behavior, and supported rendering destinations. Keep physics, AI, networking, match rules, DNA interpretation, minting, and account behavior unchanged. Preserve the existing SVG character generator and its approved geometry, materials, finishes, and lighting; upload its rasterized output as textures. A procedural rewrite of character generation is outside this task.

The important product motivation is richer effects with a renderer suited to them, especially true heat refraction. Avoid reducing visual quality just to make benchmark numbers smaller.

Resolve routine implementation choices yourself. Ask only for a material ambiguity or a blocker that cannot be resolved from the code and these requirements. Do not deploy or claim device testing that was not performed.

## Current workspace state

At handoff creation, the working tree contains earlier owner-requested effects changes and the new prototype. Inspect `git status` and the actual diff before editing; do not reset, discard, or overwrite them. Current modified files include:

- `web/ububall-presentation.js`: softer warm burn/skid marks, rounded feathered ends, and the restored live-scene Canvas heat warp.
- `web/effects.js`: corresponding Effects Demo descriptions.
- `web/ububall-bench.js` and `test/ububall-bench.test.js`: effect labels and cache/refraction checks.
- `README.md` and `scripts/serve-bench.cjs`: local prototype documentation and explicit server whitelist.

New prototype files:

- `web/ububall-webgl.js`: experimental GPU renderer.
- `web/webgl-demo.js`: shared physics/drawing-command comparison harness.
- `web/webgl-demo.html`: standalone local comparison page.

These changes were uncommitted when this handoff was written. Recheck rather than assuming their status remains unchanged. Do not commit unrelated work or deploy unless subsequently requested.

## What the prototype actually does

Run `npm run bench:serve`, then open `http://127.0.0.1:8791/webgl-demo.html`. A server may already be listening on port 8791; check before starting another.

The page creates six deterministic sample ubus with the shared generator, bakes their actual artwork through `ubuRender.sprite`, runs the real physics engine, and passes a shared list of textured rectangles to Canvas 2D and WebGL2. It includes a baked rink, ball, flame sprites, and bounded burn stamps. Controls provide pause/resume, restart, heat enable/disable, warp strength, resolution, and solo/both views.

The GPU renderer uploads artwork once, draws a scene into a framebuffer texture, then samples displaced texture coordinates in a postprocess shader. This is actual image refraction. It does not capture the live Canvas 2D image every frame. It currently issues one draw call per sprite; it is not yet batched or instanced. The primitive scene is intentionally partial and does not implement the full game's effects or presenter contract.

The Canvas demo reference currently has no heat warp. Its timing therefore is not an equivalent-feature comparison. The comparison also does not use the full production Canvas renderer. Correct these limitations before drawing migration-performance conclusions.

The prototype handles WebGL context loss/restoration and releases resources on page exit. It uses a logical 1000 x 600 scene. It is explicitly whitelisted in the local benchmark server, but excluded from deployment assets. Production integration will need deliberate whitelist/script-loading updates, not serving the repository root.

## Owner's visual requirements and lessons

### Heat devil / mirage

The owner means the visible image should physically bend and shimmer like rising hot air: rink markings, trails, the ball, flames, and other scene content within the affected region must be refracted. A dark region, tint, opacity fade, or distortion of only static rink details is unacceptable. Earlier cached-rink-only implementations looked invisible over plain ice and were rejected.

The current production Canvas effect captures a small live-scene region into a bounded reusable scratch canvas, then redraws it through three moving distortion shapes at full opacity. The owner explicitly chose visible warp over the original strict no-performance-cost requirement when the conflict was demonstrated. This does not remove the obligation to optimize and measure the GPU version.

Implement GPU scene-to-texture refraction without framebuffer feedback loops or recurring full-scene Canvas-to-WebGL uploads. Preserve freeze-frame/reduced-motion behavior, ignition and wall-impact variants, and appropriate scene/UI layering. DOM skaters cannot be refracted by a canvas shader; moving rink skaters into the GPU scene matters for correct composition.

### Burn and skid marks

The owner rejected sharp lateral edges, flat start/end cutoffs, and an obvious narrow dark core inside a lighter outer stripe. They also rejected changing burn marks to a cool single-tone charcoal because it no longer matched the wall-bounce scorch and they preferred the earlier warm colors.

Current marks use a gradual warm umber-to-soot profile matching wall scorches, feathered sides, and feathered round ends. The Canvas cache avoids overlapping end caps on growing slices, and refreshes on settling so finished paths get caps. Preserve that visual behavior without introducing beads, seams, hard cutoffs, or cache/fade regressions. The GPU implementation can use an appropriate geometry/shader representation rather than duplicating the Canvas technique literally.

## Migration work to complete

1. Inspect and inventory the actual production rendering paths and effects before replacing them. Important entry points are `createRinkPresenter` and `drawScene` in `web/ububall-presentation.js`, integration in `web/ububall.js`, and callers in the Effects Demo, playback/theater, portrait/collection views, screenshots, and video export. Follow actual call sites; this list is not exhaustive.
2. Establish a maintainable GPU scene renderer with texture/resource ownership, batching of compatible sprites, explicit blending and draw order, clipping, soft ribbons, text/icon handling, resize/DPR policy, and context recovery. Keep the implementation lean; do not build a general game engine or speculative plugin layer.
3. Port the full rink presentation: skaters, ball, aiming/prediction visuals, spin arcs, guards, supers, badges, trails, marks, particles, heat, impacts, goal effects, and the overlays needed for parity. Existing UI may remain DOM where appropriate. Preserve pointer interaction, selection, portrait orientation, and overlays' intended depth.
4. Integrate live play, CPU and online matches, replay/theater, Effects Demo, persistent rink navigation, and exported images/video. Preserve the renderer's supported modes and lifecycle. Prevent hidden/background screens from doing unnecessary rendering or leaking resources.
5. Define graceful behavior when WebGL2 initialization fails or a context is lost. Initially retain the working Canvas path as a fallback/reference where practical. Avoid implementing an additional WebGL1 or WebGPU backend. Document the final fallback scope and its limitations accurately.
6. Update only necessary public asset whitelists and script-loading paths. Keep the standalone lab useful for comparison, or simplify it once integrated. Keep `web/effects.html` / `EFFECT_GROUPS` accurate whenever effects change.
7. Finish with a concise report of implemented scope, tests, measured performance, compatibility evidence, and any concrete remaining limitations. Do not label an incomplete port production-ready.

## Verification and evidence

- Use identical state, effects, resolution, and workload for comparisons. Solo mode isolates renderer work; running two views simultaneously cannot measure production frame pacing.
- Verify visual parity with distortion disabled, then verify visible animated distortion on flames, ball outlines, trails, and rink lines. Test representative rare character finishes as well as ordinary sprites.
- Exercise aiming/dragging, turns and settling, collisions, wall burns, goals, freeze frames, replay seeking, resize, portrait/mobile layout, context loss/restoration, navigation away/back, and image/video export. Use existing Effects Demo scenarios as coverage rather than inventing unrelated infrastructure.
- Run appropriate repository tests, including effects/benchmark/cache checks and broader suites when integration changes warrant them. Update Canvas-specific tests to cover the intended behavior, not merely to bless a changed implementation. Worker/auth/mint suites are required by project instructions if those areas change; this task should ordinarily avoid changing them.
- Browser automation already found and fixed an upside-down framebuffer texture in the prototype. Preserve explicit coordinate conventions and premultiplied-alpha handling. A disabled-warp comparison measured a mean RGB channel difference around 0.07/255 for the simple prototype scene; this is a starting observation, not proof of full parity.
- Prototype browser checks passed shader compilation, zero GL errors, pause/solo/resolution controls, and simulated context recovery. Desktop headless Chromium and a narrow viewport were tested; a narrow viewport is not an actual Android/iOS device test.
- Measure CPU submission, sustained frame intervals, memory/resource growth, startup, and GPU timing where available. Separate these metrics. Do not call refresh waiting or `frame interval minus selected JS timers` GPU rendering time. Avoid forced readbacks in representative frame benchmarks.
- The reports under `bench-results/bench-windows-2026-11-13T02-18-42-068Z-db29.md` and `bench-results/bench-android-2026-11-13T02-19-37-279Z-feef.md` are historical clues, not a baseline for current code. Repeated runs and actual device checks are needed. Thresholds in the benchmark implementation also do not exactly equal the displayed 8.3/16.7 ms headings; inspect them.
- Do not promise a universal shader cost, flat frame time, native-DPR 240 Hz, or better battery life without measurement. The earlier live Canvas heat experiments showed significant high-resolution cost. WebGL2 is the proposed remedy to test, not an already-proven performance guarantee.

## Scope of owner involvement

The owner has already discussed and accepted the direction. Their request for this handoff is to let another agent carry the transition through as one assignment. Treat prototyping, implementation, bug fixing, integration, and testing as internal steps. Escalate only real decisions or blockers; do not turn routine progress into repeated permission requests. Deployment is not authorized by this handoff.
