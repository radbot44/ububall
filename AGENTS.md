# Working on ububall

Ububall is a standalone 3v3 physics hockey game and collectible ubu ecosystem (including Ubu Mint). Read [README.md](README.md) for the product, local commands and current entry points. Work on the owner's requested scope; a proposal or an archived handoff is not authorization to change a permanent protocol or deploy.

## Where the rules live

Read the **relevant** specification before changing its system, rather than loading every document for every task:

| Work | Source of truth |
| --- | --- |
| DNA fields, decoding, visual traits, palette | [docs/dna.md](docs/dna.md) |
| Naming algorithm | [docs/uburithm.md](docs/uburithm.md) |
| Match rules, stats, supers and CPU behavior | [docs/ububall.md](docs/ububall.md), [docs/cpu-simulation.md](docs/cpu-simulation.md) |
| File formats and signatures | [docs/ubu-file.md](docs/ubu-file.md), [docs/ububall-file.md](docs/ububall-file.md) |
| Mint batches, starter packs, ownership, online access | [docs/mint.md](docs/mint.md), [docs/worker.md](docs/worker.md), [docs/ububall-online.md](docs/ububall-online.md) |
| Persistent rink, navigation and established UI decisions | [docs/rink-stage.md](docs/rink-stage.md) |
| Tests, deployment and sandbox-specific workarounds | [docs/development.md](docs/development.md), [docs/worker.md](docs/worker.md) |

Only approved specifications and implemented behavior are binding. Keep proposed experiments distinct; ask before changing an accepted protocol, game rule or owner-approved design.

## Protocol, ownership and security

- DNA is **exactly 1024 bits (128 bytes)**. Preserve every byte, existing field assignments, reserve bits and deterministic interpretation. There is no legacy 256/512-bit compatibility. Text-to-DNA uses exact UTF-8 and the documented dual SHA-512 flow; random generation uses platform cryptography. Do not silently normalize or reinterpret inputs. The packed uburithm and assigned visual materials are fixed. Consult the canonical specifications and vector tests for exact values, not this summary.
- Keep DNA separate from its transport certificate and current ownership. Custom `.ubu` files imply neither official minting nor ownership. Verify signed certificates against **caller-trusted** mint public keys, without trusting keys supplied by the file or silently falling back to unsigned. Never install test keys as production trust.
- The mint generates its own random DNA. Respect atomic, unique, idempotent serial and batch allocation, lifetime limits and the special signup/daily pack rules in `docs/mint.md`. Never bypass account, origin, session, membership or ownership checks. Guests and CPUs are not official owners.
- Never commit, log, bundle or expose production credentials, signing keys, private state or mint secrets. Public verification material must not confer minting authority. Keep private keys out of browser code. Use platform cryptography, not custom primitives.

## Game, rendering and interaction

- This is a **game**, including inside Discord Activities and mobile browsers, not a generic form-driven site. Preserve the established custom game UI and persistent rink. Read `docs/rink-stage.md` before changing the stage, menus, navigation or screen layout.
- For production game UI use shared components in `web/game-ui.js`: no `alert()`, `confirm()`, `prompt()`, native browser-styled select menus or inline-expanding dropdowns. Overlay controls from their triggers; use Tabler SVG icons, not textual glyph substitutes. Designer/workbench pages are temporary exceptions.
- Preserve Discord Activity membership, ready/challenge behavior, online forfeit versus reconnect grace, private player drafts and opt-in external spectating as documented in `docs/ububall-online.md`. Online match state is server-authoritative; do not promote client simulations into the next turn or demand exact cross-engine equality for cosmetic comparisons.
- When effects or sound behavior changes, update the `web/effects.html` catalog and `EFFECT_GROUPS` in `web/effects.js` alongside the implementation.

## Implementation and verification

- Prefer plain JavaScript, platform APIs and the smallest code and dependency surface meeting a **current** requirement. No speculative framework, plugin infrastructure or build system. Keep each rule implemented once; avoid repeated conversions, unbounded caches and heavyweight mint request paths.
- Measure performance before claiming an optimization; consider CPU/latency, memory, startup and code size. Performance work must not weaken determinism, cryptography, authorization or atomic ownership.
- **Keep tests minimal and high-value—do not add tests unless they guard a real, recurring risk.** Only write or extend tests for permanent protocol/binary formats, cryptography, trust/auth boundaries, atomic mint/ownership accounting, server-authoritative online rules, OTA safety, or core physics/replay determinism. Never add trivial, frivolous, or bloat tests:
  - No source-text, CSS, HTML, PowerShell, or Markdown greps (`readFileSync` + string/regex matching).
  - No fake browser/DOM/Canvas/WebGL/WebAudio/VideoEncoder mock suites asserting call counts, draw order, attributes, CSS properties, or timer churn. Test pure math/state directly; verify UI and visuals in a real browser.
  - No cosmetic, copy, or balance-tuning locks (hex colors, stroke widths, particle counts, audio cutoffs, callout strings, stat/rarity formula mirrors, or brittle CPU tactical puzzles—`ububall-replay.test.js` already locks physics determinism).
  - No "Phase N" / roadmap / task-diary tests, no dead one-off migration tests, and no offline Python/ML/calibration/Monte Carlo scripts in `npm test`.
  - If a test needs heavy mock scaffolding just to run, do not write it. Run relevant tests and report what actually ran, failed or skipped. For mint/Worker/auth work run `npm test` and `npm run test:worker` when the environment supports them. `scripts/prepare-assets.cjs` explicitly controls published assets; never serve the repository root.
- Work and run commands inside this repository. `shared/ubu-render.js` is used by the designer and the site; preserve accepted geometry, finishes and lighting.

## Operations are separate from code changes

- Deployment, signing-key changes, production configuration, external account setup, mint reset and publishing require explicit owner direction. Do not treat a code task or proposal as deployment approval.
- On Windows, `install.ps1` copies the source checkout to sibling `ubumint-cloudflare`, verifies and deploys; `-DryRun` validates without upload. Never Git pull/stash in the deployment copy. Production settings and permanent keys live outside Git in `%LOCALAPPDATA%\\ubumint\\settings.json`. Preserve them; do not use `-Setup` for an existing mint or replace saved settings with development defaults. Keep `keep_vars` enabled.
- A reset changes mint identity, signing keys and registry. Only run `-ResetMint` when explicitly requested, never reset just serial counters, and follow `docs/worker.md` for recovery and retries.
