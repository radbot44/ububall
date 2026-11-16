# ububall

Playable simultaneous-turn 3v3 physics hockey game and collectible ubu ecosystem with Ubu Mint.

Design requirement: a lean application with zero fluff. Use the smallest practical implementation of current requirements, platform APIs and minimal dependencies. Measure meaningful optimizations; preserve DNA correctness, security and ownership integrity. Detailed engineering constraints are in [AGENTS.md](AGENTS.md).

## Product overview

- **ububall** is the playable game on the homepage at `/`: three-versus-three simultaneous-turn physics hockey on a curved-corner rink, first to five. Playable immediately with local CPU matches and private Cloudflare-backed online multiplayer matches. Players drag on the rink to aim each ubu, or fine-tune its angle, power and spin with knobs (on each team card on wide screens; in a dock for the selected ubu on phones and narrow windows), then launch the team simultaneously. The pause menu sets the aim style, the floating spin slider (on by default with a mouse, off on touch screens) and the Show moves and Show trails overlays. Teams are set in kickoff formation (Back, Top, Bottom) from the player's collection, which starts with a signup pack and grows by a daily pack (guests get three ubus they cannot keep), with each ubu's super chosen in its position; signed-in players can save named teams to their account, flip between them, and start with the team they played last. Online lobbies use the same team screen. Local CPU matches run in the browser, while online matches are resolved authoritatively by the Cloudflare Durable Object; each match is saved as a replay on the device (the latest 25, plus any pinned), to watch with a timeline, moves, trails and stats, play on from any turn, share as a picture, rename, import, and export (the match, a round or a turn, optionally with names hidden) as a `.ububall` file or an MP4 video ([replays](docs/ububall-file.md)). Legacy `/ububall.html` URLs redirect seamlessly to the homepage, preserving match identifiers.
- **Ubu Mint** is the collectible minting system at `/mint`, with owned ubus at `/collection`. Play, Ubu Mint and Collection are screens of one page (`web/app.js` switches them by path); `/mint.html` redirects to `/mint`. Players discover new ubus, open packs, collect favorites, verify cryptographic certificates, and build collections for use in ububall. The local Cloudflare application includes atomic batch allocation, Discord OAuth sign-in, signed minting, persistent pack storage and a configurable lifetime mint limit.
- **ubu** refers to the characters and their underlying 1024-bit DNA, certificate, audio synthesis, and SVG/canvas rendering systems.

## Running and installing

Run `npm run dev` to open the local Worker at http://127.0.0.1:8790/. Setup and verification are in the [Cloudflare application guide](docs/worker.md). The Worker has no runtime npm packages. The framework-free client loads the Embedded App SDK when connecting from Discord. See [online play](docs/ububall-online.md) for Activity lobbies, challenges, queues, spectating and setup.

Install updates and deploy with **`.\install.ps1`** from either your local source checkout or the deployment copy at `ubumint-cloudflare`. The installed copy automatically forwards to the source checkout. It copies the current source into sibling `ubumint-cloudflare`, installs dependencies, runs both test suites and deploys. Use **`.\install.ps1 -DryRun`** to check everything without uploading. Local settings and existing mint keys live outside either checkout in **`%LOCALAPPDATA%\ubumint\settings.json`**; reinstalling code does not replace them. No stashing or editing tracked Wrangler files is needed. For first-time setup, see [first setup](docs/worker.md#first-setup-and-updates). Both test commands use the compact dot reporter.

To install updates and start a fresh mint, use `.\install.ps1 -ResetMint`; to reset only the installed mint, run `.\deploy.ps1 -ResetMint` from the deployment folder. This explicitly replaces the mint identity/keys and session secret, selecting a fresh registry starting at serial 1 while preserving the domain, Discord credentials and allowance. Previous registry Durable Object storage is retained separately. See [reset details](docs/worker.md#fresh-mint-reset).

## DNA, naming and file formats

Every ubu has a permanent 1024-bit (128-byte) DNA value. Its deterministic visual traits, gameplay stats, abilities, audio and naming rules are specified in [the canonical DNA specification](docs/dna.md) and [the uburithm](docs/uburithm.md). The [gameplay specification](docs/ububall.md) covers what those stats and abilities do in a match. Obsolete 256-bit and 512-bit codes are not supported.

Two `.ubu` formats exist: unsigned custom DNA and mint-signed issuance certificates. A custom file is not proof of ownership. For canonical serialization, signatures, trust and host policy, see [the file profile](docs/ubu-file.md); for match replays, see [the `.ububall` format](docs/ububall-file.md).

The ordered 32-color palette and exact field allocations live in [docs/dna.md](docs/dna.md#colors), not in a second copy here.

## Additional labs and tools

- **Designer:** Open `web/demo.html` (or `/demo.html` under `npm run dev`) for standalone DNA inspection, trait editing, card/token previews, and custom `.ubu` import/export.
- **Voice & Goal Fanfare Lab:** Open `web/voice.html` (or `/voice.html` under `npm run dev`) to test Web Audio procedural voice synthesis and 128-bit DNA-derived 2-bar goal anthems (bits 534–661).

- **WebGL2 rink lab (local only):** Run `npm run bench:serve` and open http://127.0.0.1:8791/webgl-demo.html. Compares the full production `createRinkPresenter` across WebGL2 (default live rink renderer with batched GPU sprites/SDFs, feathered umber/skid ribbons and scene-to-texture heat refraction) and the Canvas 2D fallback reference on identical physics and artwork, with pause/step, heat, context-loss, resolution and solo-view controls. Excluded from deployment assets.

## Testing

Run tests with:
- `npm test`: runs unit and integration tests across audio, rendering, physics, match engine, DNA decoder, file profiles, appearance rarity, mint transactions, auth and installer forwarding.
- `npm run test:worker`: runs isolated Cloudflare Worker runtime integration tests against ephemeral local storage.

CPU search, difficulty presets and reproducible match experiments: [CPU simulation guide](docs/cpu-simulation.md). Run `npm run test:cpu` for focused checks or `npm run sim:cpu -- --scenarios --a hard` for tactical diagnostics.
