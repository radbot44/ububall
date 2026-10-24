# ubumint

Private, owner-operated project for minting ubus for uburoom.

Design requirement: a lean mint with zero fluff. Use the smallest practical implementation of current requirements, platform APIs and minimal dependencies. Measure meaningful optimizations; preserve DNA correctness, security and ownership integrity. Detailed engineering constraints are in AGENTS.md.

DNA and appearance frozen by owner acceptance on 2026-10-23. No versions or future expansion. The local Cloudflare application includes a viewer, designer, Discord OAuth code, signed minting, persistent batches and a configurable lifetime mint limit. Production credentials, deployment and transfers are not configured.

Run `npm run dev` to open the local Worker website at http://127.0.0.1:8790/. Setup and verification are in the [Cloudflare application guide](docs/worker.md). No runtime packages or frontend framework; Wrangler is the development dependency for local Workers execution and testing.

Install updates and deploy with **`.\install.ps1`** from either this source checkout or `ubumint-cloudflare`. The installed copy forwards to the source checkout. It copies the current source into sibling `ubumint-cloudflare`, installs dependencies, runs both test suites and deploys. Use **`.\install.ps1 -DryRun`** to check everything without uploading. Private settings and existing mint keys live outside either checkout in **`%LOCALAPPDATA%\ubumint\settings.json`**; reinstalling code does not replace them. No stashing or editing tracked Wrangler files is needed. For a brand-new mint, see [first setup](docs/worker.md#first-setup-and-updates). Both test commands use the compact dot reporter.

The permanent [DNA specification](docs/dna.md) and [uburithm](docs/uburithm.md) define the generator. The [.ubu profile](docs/ubu-file.md) defines certificates. Run `npm test` and `npm run test:worker` for core and Cloudflare runtime checks.

To install updates and start a fresh mint, use `.\install.ps1 -ResetMint`; to reset only the installed mint, run `C:\dev\ubumint-cloudflare\deploy.ps1 -ResetMint`. This explicitly replaces the mint identity/keys and session secret, selecting a fresh registry starting at serial 1 while preserving the domain, Discord credentials and allowance. Previous registry data remains archived in Cloudflare. See [reset details](docs/worker.md#fresh-mint-reset).

## Product baseline

- An ubu is deterministically formed from random DNA, including its ubunym and oomark.
- DNA supplies random input to generation rules. Multiple DNA values may produce the same currently visible traits.
- There is one permanent, closed set of DNA laws, without generator versions or future expansion. All 256 bits are allocated. Existing meanings and outputs are permanent.
- Ordinary minting generates DNA at the mint rather than accepting a caller-selected seed. Supported customization policy belongs to the consuming host; this does not prevent local browser modifications or hunting through repeated mint requests.
- Ubucodes must visibly distinguish plain and protected forms. Parsing must distinguish them strictly; failed protected codes cannot fall back to plain decoding. Exact prefixes and host acceptance rules remain to be specified.
- Cloudflare Workers is the intended minting target: a request obtains newly generated DNA in an authorized ubucode. No cloud resources have been provisioned.

## Current color input

The owner supplied this ordered 32-color palette. Each of the five current color roles (background, eye rings, irises, pupils and mouth) can draw one equally likely color from five random bits, for 25 bits total.

Palette order, hex values and the field mapping in docs/dna.md are permanent.

| Index | Color | Hex |
| --- | --- | --- |
| 0 | Coral | #FF7D69 |
| 1 | Sienna | #A56C57 |
| 2 | Copper | #CD7847 |
| 3 | Tangerine | #FF9954 |
| 4 | Ochre | #B68720 |
| 5 | Saffron | #E8CA48 |
| 6 | Chartreuse | #B4D858 |
| 7 | Olive | #758C3D |
| 8 | Emerald | #42C66B |
| 9 | Mint | #B9ECCD |
| 10 | Seafoam | #89D8B5 |
| 11 | Forest | #21845B |
| 12 | Teal | #138F99 |
| 13 | Turquoise | #47C8DE |
| 14 | Sky | #76B9EF |
| 15 | Volt | #0066FF |
| 16 | Cobalt | #2659AC |
| 17 | Cornflower | #477AE7 |
| 18 | Indigo | #4F5FC2 |
| 19 | Periwinkle | #9E9EED |
| 20 | Iris | #C5A3FF |
| 21 | Amethyst | #AA54D3 |
| 22 | Aubergine | #673C75 |
| 23 | Orchid | #DA4DB5 |
| 24 | Mulberry | #9D467A |
| 25 | Burgundy | #7C3349 |
| 26 | Rose | #FF7197 |
| 27 | Vermilion | #EE4455 |
| 28 | Alabaster | #F8F6F2 |
| 29 | Slate | #706D77 |
| 30 | Gunmetal | #292E38 |
| 31 | Onyx | #101217 |

## Naming direction

The starting generator produces a six-letter nomen and six additional letters split into one or two surrounding words. The extra word length is selected from 2, 3, 4 or 6; orientation determines which side receives it. Letter choices follow constrained consonant/vowel patterns.

The owner requires the existing naming rules and a 64-bit seed at the start of DNA. The official algorithm is called the uburithm. Its calculation may be optimized without changing naming rules. Text seeds are converted from exact UTF-8 text through SHA-256 into the complete DNA; its first 64 bits directly initialize the name stream. Random DNA and imported DNA bypass text hashing. The exact stream calculation is permanent.

## Separate mint decisions

DNA is fixed. Two .ubu forms are approved:

- **Unsigned/custom:** contains DNA, freely designed or generated by anyone. It carries no proof of official issuance or registered ownership.
- **Mint-signed:** contains DNA, a permanent twelve-digit mint serial (000000000001–999999999999), and certificate metadata covered by a signature verifiable against a trusted mint public key. Only successful verification establishes mint authenticity; a signature field or claimed mint name alone does not.

Both forms use the same frozen DNA and renderer. Hosts choose whether to allow custom ubus or require mint-signed ones. Missing required signature data, an unknown/untrusted key or a failed signature never downgrades a signed-form file to unsigned. A deliberate export of its DNA as a new unsigned file carries no official status. Current transferable ownership is checked against the mint registry, separately from the issuance signature.

The [file profile](docs/ubu-file.md) is implemented in ubu-file.js using platform Ed25519 and strict JSON validation. It is a working development format, separate from frozen DNA. Encryption is not selected. Key distribution/rotation, Discord ownership, mint allowances and trade APIs remain separate work.

Approved mint policy: prepare batches of **1,000** by default (configurable for subsequent batches), distribute randomly without replacement, and sign each ubu when assigned to its first owner. Serials follow creation order. The next batch starts after exhaustion. Persistent batch storage, alarm scheduling, Discord OAuth and a configurable per-account lifetime limit are implemented locally; see the [service guide](docs/mint.md), [Cloudflare guide](docs/worker.md) and [file profile](docs/ubu-file.md#mint-batches). New issuance defaults to disabled until the owner configures a nonzero allowance.

## Illustrative lengths, not a format specification

Assuming 32 bytes of DNA and unpadded base64url:

- Plain DNA: 43 payload characters.
- AES-GCM with a 12-byte nonce and 16-byte tag: 80 payload characters.
- DNA plus a 64-byte Ed25519 signature: 128 payload characters.

Prefixes, key identifiers and other metadata add length. Encryption alone does not establish a cross-installation trust model: distributing a shared symmetric key also distributes the ability to mint valid codes. A central signature allows public verification without sharing mint authority.

## Local demo

Open demo.html with ubu.js, ubu-file.js, ubu-render.js and demo.js beside it, or serve them on localhost. No framework or runtime dependencies. Text seeds use platform SHA-256; random generation uses platform randomness. The standalone designer has no production mint keys, account or remote API calls.

The demo supports text seeds, canonical base64url or hexadecimal DNA input, local favorites/history, trait inspection, fixed schema samples and official-format custom .ubu import/export. Its 66-byte export contains only {"type":"ubu","dna":"..."}. Old ubu-demo envelopes are rejected; signed files are rejected until the application configures a trusted mint key. No key is trusted from an imported file.

The decoder in ubu.js is separate from DOM rendering in ubu-render.js. The site, designer and thumbnails share that renderer. Rendering rules and verification limits are recorded in docs/dna.md.
