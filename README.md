# ububall

Playable simultaneous-turn 3v3 physics hockey game and collectible ubu ecosystem with Ubu Mint.

Design requirement: a lean application with zero fluff. Use the smallest practical implementation of current requirements, platform APIs and minimal dependencies. Measure meaningful optimizations; preserve DNA correctness, security and ownership integrity. Detailed engineering constraints are in [AGENTS.md](AGENTS.md).

## Product overview

- **ububall** is the playable game on the homepage at `/`: three-versus-three simultaneous-turn physics hockey on a curved-corner rink, first to five. Playable immediately with local CPU matches and private Cloudflare-backed online multiplayer matches. Players drag on the rink to aim each ubu, or fine-tune its angle, power and spin with knobs (on each team card on wide screens; in a dock for the selected ubu on phones and narrow windows), then launch the team simultaneously. The floating spin slider is a pause-menu setting, on by default with a mouse and off on touch screens. Team rosters can be formed from practice characters or loaded directly from authenticated player collections unlocked through the Ubu Mint. Matches run locally in the browser; each one is saved as a replay on the device (the latest 25), to watch with a timeline or export as a `.ububall` file ([replay format](docs/ububall-file.md)). Legacy `/ububall.html` URLs redirect seamlessly to the homepage, preserving match identifiers.
- **Ubu Mint** is the collectible minting system at `/mint`, with owned ubus at `/collection`. Play, Ubu Mint and Collection are screens of one page (`web/app.js` switches them by path); `/mint.html` redirects to `/mint`. Players discover new ubus, open packs, collect favorites, verify cryptographic certificates, and build collections for use in ububall. The local Cloudflare application includes atomic batch allocation, Discord OAuth sign-in, signed minting, persistent pack storage and a configurable lifetime mint limit.
- **ubu** refers to the characters and their underlying 1024-bit DNA, certificate, audio synthesis, and SVG/canvas rendering systems.
- **uburoom** is a separate existing companion project; it is not renamed or merged.

## Running and installing

Run `npm run dev` to open the local Worker website at http://127.0.0.1:8790/. Setup and verification are in the [Cloudflare application guide](docs/worker.md). No runtime packages or frontend framework; Wrangler is the development dependency for local Workers execution and testing.

Install updates and deploy with **`.\install.ps1`** from either your local source checkout (`C:\dev\ububall` or legacy `C:\dev\ubumint`) or the deployment copy at `ubumint-cloudflare`. The installed copy automatically forwards to the source checkout. It copies the current source into sibling `ubumint-cloudflare`, installs dependencies, runs both test suites and deploys. Use **`.\install.ps1 -DryRun`** to check everything without uploading. Private settings and existing mint keys live outside either checkout in **`%LOCALAPPDATA%\ubumint\settings.json`**; reinstalling code does not replace them. No stashing or editing tracked Wrangler files is needed. For first-time setup, see [first setup](docs/worker.md#first-setup-and-updates). Both test commands use the compact dot reporter.

To install updates and start a fresh mint, use `.\install.ps1 -ResetMint`; to reset only the installed mint, run `C:\dev\ubumint-cloudflare\deploy.ps1 -ResetMint`. This explicitly replaces the mint identity/keys and session secret, selecting a fresh registry starting at serial 1 while preserving the domain, Discord credentials and allowance. Previous registry data remains archived in Cloudflare. See [reset details](docs/worker.md#fresh-mint-reset).

## 1024-bit DNA specification

The owner approved the 1024-bit (128-byte) DNA schema on 2026-10-26. DNA supplies deterministic random input to permanent generation rules. Obsolete 256-bit beta and 512-bit ubus are rejected without conversion. See the authoritative [DNA specification](docs/dna.md) and [Ububall specification](docs/ububall.md).

- **Representation:** Canonical unpadded base64url is exactly 171 characters (or 256 hexadecimal characters).
- **Text seeds:** Converted from exact UTF-8 text through dual SHA-512 into complete 128-byte DNA (first 64 bytes from SHA-512(text), second 64 bytes from SHA-512(text + '\x01')).
- **Ubunym naming:** Initialized directly from the first 64 DNA bits and evaluated via the official `uburithm` SplitMix64 generator (`docs/uburithm.md`).
- **Visual traits (bits 0–373, 374 bits):** 5 body-part attribute slots (background, eye rings, irises, pupils, mouth) with 18 bits each, drawing colors from the 32-color palette and finishes across 32 assigned rare materials, plus geometric mouth/eye controls, corner curvature and lip-notch cuts.
- **Core game stats (bits 374–493, 120 bits):** 15 stats evaluated with an exponential multiplier curve, equal percentage per stat point (0 = 2/3×, 127 = 1.0×, 255 = 1.5×):
  - *Movement (8 bits each):* Impulse, Traction, Spin, Curve.
  - *Physical (8 bits each):* Size, Mass, Bounciness, Grip.
  - *Engagement (8 bits each):* Power, Reach, Strength, Stability.
  - *Super (8 bits each):* Efficiency, Synergy, Chemistry.
- **Super slots (bits 494–509, 16 bits):** 4 special ability slots (4 bits each, 0–15).
- **AI tactical brain (bits 510–533, 24 bits):** Personality axes for Aggression, Creativity, Teamwork, Clutch (6 bits each, 0–63).
- **Voice & fanfare suite (bits 534–597, 64 bits):** Web Audio voice synthesizer (root pitch, instrument timbre, decay) and 8-note goal fanfare melody with scale mode, tempo, and groove.
- **Unassigned reserve (bits 598–1013, 416 bits):** Headroom preserved for future expansion.
- **Ubuquity (bits 1014–1023, 10 bits):** Starting special meter percentage (0–1023).

## Color palette

The owner supplied this ordered 32-color palette. Each of the five color roles draws one equally likely color from 5 random bits. Palette order, hex values and field mappings are permanent.

| Index | Color | Hex | Index | Color | Hex |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | Coral | #FF7D69 | 16 | Cobalt | #2659AC |
| 1 | Sienna | #A56C57 | 17 | Cornflower | #477AE7 |
| 2 | Copper | #CD7847 | 18 | Indigo | #4F5FC2 |
| 3 | Tangerine | #FF9954 | 19 | Periwinkle | #9E9EED |
| 4 | Ochre | #B68720 | 20 | Iris | #C5A3FF |
| 5 | Saffron | #E8CA48 | 21 | Amethyst | #AA54D3 |
| 6 | Chartreuse | #B4D858 | 22 | Aubergine | #673C75 |
| 7 | Olive | #758C3D | 23 | Orchid | #DA4DB5 |
| 8 | Emerald | #42C66B | 24 | Mulberry | #9D467A |
| 9 | Mint | #B9ECCD | 25 | Burgundy | #7C3349 |
| 10 | Seafoam | #89D8B5 | 26 | Rose | #FF7197 |
| 11 | Forest | #21845B | 27 | Vermilion | #EE4455 |
| 12 | Teal | #138F99 | 28 | Alabaster | #F8F6F2 |
| 13 | Turquoise | #47C8DE | 29 | Slate | #706D77 |
| 14 | Sky | #76B9EF | 30 | Gunmetal | #292E38 |
| 15 | Volt | #0066FF | 31 | Onyx | #101217 |

## .ubu file profiles

Two .ubu forms are approved and implemented in `shared/ubu-file.js`:

- **Unsigned/custom:** contains 1024-bit DNA, freely generated or designed. Carries no proof of official issuance or registered ownership. Exact serialized JSON size is 194 bytes (`{"type":"ubu","dna":"<171-character DNA>"}`).
- **Mint-signed certificate:** contains 1024-bit DNA, a permanent twelve-digit serial (000000000001–999999999999), and certificate metadata covered by an Ed25519 signature verifiable against a trusted mint public key. Exact serialized size is 425 bytes (`{"type":"ubu-signed",...}`).

See the [file profile](docs/ubu-file.md) for full encoding, signing prefix (`ubumint:issuance\n`), and verification rules.

## Additional labs and tools

- **Designer:** Open `web/demo.html` (or `/demo.html` under `npm run dev`) for standalone DNA inspection, trait editing, card/token previews, and custom `.ubu` import/export.
- **Voice & Goal Fanfare Lab:** Open `web/voice.html` (or `/voice.html` under `npm run dev`) to test Web Audio procedural voice synthesis and DNA-derived 8-note goal fanfares.

## Testing

Run tests with:
- `npm test`: runs unit and integration tests across audio, rendering, physics, match engine, DNA decoder, file profiles, appearance rarity, mint transactions, auth and installer forwarding.
- `npm run test:worker`: runs isolated Cloudflare Worker runtime integration tests against ephemeral local storage.

CPU search, difficulty presets and reproducible match experiments: [CPU simulation guide](docs/cpu-simulation.md). Run `npm run test:cpu` for focused checks or `npm run sim:cpu -- --scenarios --a hard` for tactical diagnostics.
