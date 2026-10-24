# ubumint

Private, owner-operated project for minting ubus for uburoom.

Design requirement: a lean mint with zero fluff. Use the smallest practical implementation of current requirements, platform APIs and minimal dependencies. Measure meaningful optimizations; preserve DNA correctness, security and ownership integrity. Detailed engineering constraints are in AGENTS.md.

Status: local appearance preview. The complete DNA schema is closed to future expansion but remains adjustable until owner acceptance. Cloud minting and the final signed/encrypted file format are not implemented.

The current [DNA specification draft](docs/dna-draft.md) records approved allocations and remaining decisions. The complete standard is not frozen. [The uburithm](docs/uburithm.md) records fixed naming rules and a proposed efficient calculation.

## Product baseline

- An ubu is deterministically formed from random DNA, including its ubunym and oomark.
- DNA supplies random input to generation rules. Multiple DNA values may produce the same currently visible traits.
- There is one permanent, closed set of DNA laws, without generator versions or future expansion. All 256 bits are allocated. Changes are allowed during preview, before the owner freezes the schema.
- Ordinary minting generates DNA at the mint rather than accepting a caller-selected seed. Supported customization policy belongs to the consuming host; this does not prevent local browser modifications or hunting through repeated mint requests.
- Ubucodes must visibly distinguish plain and protected forms. Parsing must distinguish them strictly; failed protected codes cannot fall back to plain decoding. Exact prefixes and host acceptance rules remain to be specified.
- Cloudflare Workers is the intended minting target: a request obtains newly generated DNA in an authorized ubucode. No cloud resources have been provisioned.

## Current color input

The owner supplied this ordered 32-color palette. Each of the five current color roles (background, eye rings, irises, pupils and mouth) can draw one equally likely color from five random bits, for 25 bits total.

This records the supplied palette order; field locations and the final mapping into the code have not been standardized.

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

The owner requires the existing naming rules and a 64-bit seed at the start of DNA. The official algorithm is called the uburithm. Its calculation may be optimized without changing naming rules. Text seeds are converted from exact UTF-8 text through SHA-256 into the complete DNA; its first 64 bits directly initialize the name stream. Random DNA and imported DNA bypass text hashing. Exact stream calculation remains under review.

## Open format decisions

1. Approved 256-bit layout: 64-bit ubunym seed, 80-bit attribute block, 24-bit corner block, 40-bit mouth geometry, 40-bit eye controls, 8-bit Ubuquity rating. See the DNA draft for authoritative allocations, rating ranges and feature rules.
2. The demo uses the documented MSB-first order, slot roles and SplitMix64 calculation for review. Text-to-DNA hashing and direct initial-state input are approved; no future expansion mechanism is planned.
3. All six corner rolls are four bits (6.25% success). The old width distribution is removed. Mouth width, height and X/Y displacement each use ten bits, as do eye X/Y displacement and the two rare left-eye flip controls. Numeric geometry and the centering curve are detailed as proposals in the DNA draft.
4. Text encoding, prefixes, canonical parsing and exact plain/protected acceptance rules.
5. Protection: central signatures, encryption, or both; trust scope and key rotation. Ed25519 signatures were recommended for independent verification across installations, but have not been selected.
6. Mint API, caller identity, allowances, abuse controls and any durable accounting.

These decisions define DNA generation separately from the envelope that proves issuance. A permanent DNA interpretation does not by itself settle cryptographic envelope evolution.

## Illustrative lengths, not a format specification

Assuming 32 bytes of DNA and unpadded base64url:

- Plain DNA: 43 payload characters.
- AES-GCM with a 12-byte nonce and 16-byte tag: 80 payload characters.
- DNA plus a 64-byte Ed25519 signature: 128 payload characters.

Prefixes, key identifiers and other metadata add length. Encryption alone does not establish a cross-installation trust model: distributing a shared symmetric key also distributes the ability to mint valid codes. A central signature allows public verification without sharing mint authority.

## Local demo

Open demo.html with ubu.js and demo.js beside it, or serve these files on localhost. No build step, framework or dependencies. Text seeds use platform SHA-256; random generation uses platform randomness. There are no signing, encryption, account or remote API calls.

The demo supports text seeds, canonical base64url or hexadecimal DNA input, local favorites/history, trait inspection, fixed schema samples and unsigned .ubu import/export. The temporary export contains only {"type":"ubu-demo","dna":"..."}; it is not the future mint certificate format.

The decoder in ubu.js is separate from DOM rendering in demo.js. Both the main preview and thumbnails use the same renderer. Rendering decisions and verification limits are recorded in docs/dna-draft.md.
