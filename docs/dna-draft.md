# Ubu DNA working draft

Status: complete closed-schema preview, not yet frozen. The owner permits appearance changes before acceptance and rejects future expansion afterward. ubu.js and demo.js implement the preview choices below; signatures and encryption are not implemented.

## Owner requirements

- DNA is random input to deterministic generation, rather than an editable list of resulting traits.
- One canonical, permanent, closed interpretation, without generator versions or future expansion. Preview changes are permitted before owner acceptance; laws are fixed afterward.
- The first 64 bits seed the ubunym. Existing naming rules are set; calculation efficiency may improve. The official algorithm is named the uburithm; see uburithm.md.
- Five body-part attribute slots each contain five color bits, three texture-angle bits and eight mutually exclusive texture bits, for 80 bits total. No extra body-part slots. The palette is recorded in README.md.
- The owner revised both mouth-pair rolls to four bits, for 24 corner bits. The old eight-bit width distribution is removed. Four ten-bit fields control mouth width, height and horizontal/vertical displacement. Four more ten-bit fields control eye horizontal/vertical displacement and rare left-eye horizontal/vertical flips. The last eight bits determine Ubuquity; no bits remain vacant.

## Approved input paths

- Text seed: encode the exact text as UTF-8, hash those bytes with SHA-256, and use the resulting 32 bytes as the complete DNA. Preserve case, whitespace and leading zeros; do not trim, case-fold or normalize the input. An empty string is valid. Equivalent-looking Unicode text with different code-point sequences can produce different DNA.
- Random generation: generate 32 bytes with platform cryptographic randomness.
- Existing DNA or a .ubu file: read the complete DNA directly; never hash it again as if it were a text seed.
- The first 64 DNA bits directly initialize the uburithm name stream. Text hashing occurs at the whole-DNA boundary, not again inside the name generator.
- These generator input paths do not grant mint authority. Accepting caller-chosen text seeds for official minting is a separate policy decision; ordinary random minting remains the baseline.

For a cross-platform reference, input is Unicode text encoded as UTF-8 with no byte-order mark. The preview uses TextEncoder, which replaces unpaired UTF-16 surrogates with U+FFFD; this malformed-input behavior remains subject to permanent API review. Valid Unicode text receives no normalization.

## Representation details

- Exactly 32 bytes (256 bits), populated by one of the approved input paths. Ordinary minting uses cryptographic randomness; do not zero fields whose current effect happens to be invisible.
- Bits numbered 0 through 255, byte order first to last, most significant bit first within each byte. Field values are unsigned, most significant bit first. Fields may cross byte boundaries.
- When represented as text, use canonical unpadded base64url (43 characters) decoding to exactly 32 bytes, with unused encoding padding bits zero. Text envelope prefixes are a separate decision.
- All DNA patterns are valid. No mutable ownership, mint identity, timestamp, signature, encryption material or generator version is stored inside DNA.
- DNA equality compares all 32 bytes. Equal current appearances do not imply equal DNA or equal minted identity.

## Approved block layout

The owner approved this block order and revised the attribute block to five 16-bit slots. Detailed bit ranges below use the proposed MSB-first convention; byte/bit reading order still needs approval. Slot roles follow the prototype's existing order and remain a proposed role mapping.

| Inclusive bit range | Width | Purpose |
| --- | --- | --- |
| 0-63 | 64 | Ubunym seed |
| 64-79 | 16 | Attribute slot 0: background |
| 80-95 | 16 | Attribute slot 1: eyes |
| 96-111 | 16 | Attribute slot 2: irises |
| 112-127 | 16 | Attribute slot 3: pupils |
| 128-143 | 16 | Attribute slot 4: mouth |
| 144-147 | 4 | Top mouth-pair roll |
| 148-151 | 4 | Bottom mouth-pair roll |
| 152-155 | 4 | Top-left individual corner roll |
| 156-159 | 4 | Top-right individual corner roll |
| 160-163 | 4 | Bottom-left individual corner roll |
| 164-167 | 4 | Bottom-right individual corner roll |
| 168-177 | 10 | Mouth width |
| 178-187 | 10 | Mouth height |
| 188-197 | 10 | Mouth horizontal displacement |
| 198-207 | 10 | Mouth vertical displacement |
| 208-217 | 10 | Iris/pupil horizontal displacement |
| 218-227 | 10 | Iris/pupil vertical displacement |
| 228-237 | 10 | Left-eye horizontal flip roll |
| 238-247 | 10 | Left-eye vertical flip roll |
| 248-255 | 8 | Ubuquity rating |

64 + 80 + 24 + 40 + 40 + 8 = 256 bits. An attribute slot starts at absolute bit 64 + 16 times its slot index (0 through 4).

This revises the pre-release draft; no permanent DNA has been minted. There are no vacant fields inside the five attribute slots. Inactive texture combinations remain defined as no texture; do not later reinterpret them as additional textures.

All 256 bits are allocated. No future expansion or extension mechanism is planned.

## Body-part attributes

Each 16-bit slot, in field order:

| Relative bits | Meaning |
| --- | --- |
| 0-4 | Color index |
| 5-7 | Texture orientation: eight angles in 45-degree steps |
| 8-11 | Texture gate: all four bits must be one |
| 12 | Metallic selector |
| 13 | Glossy selector |
| 14 | Matte selector |
| 15 | Crystalline selector |

A texture applies only when the gate is 1111 and exactly one selector is one. All other combinations mean no texture. Given uniform random DNA, each part has a 1/64 (1.5625%) chance of any texture; each individual texture has a 1/256 (0.390625%) chance.

Interpret the three-bit orientation value as 0 through 7, mapping to 0, 45, 90, 135, 180, 225, 270 and 315 degrees respectively. Each is equally likely. Rotate the texture about the center of the ubu's outer circle (180, 180 in the reference 360-by-360 viewBox), using the same global pivot for all parts, rather than each part's local center. Orientation has no visible effect when there is no texture; preserve its DNA bits nevertheless.

Preview styling: positive rotation is clockwise in SVG coordinates. At zero degrees, lighting bands vary along global X; matte uses a six-unit dotted tile and crystalline uses a 48-unit triangular tile. Metallic uses multiple sharp light/dark bands; glossy uses a wider smooth highlight; matte has low-contrast grain without specular bands; crystalline uses contrasting facets. SVG gradients/patterns rotate around (180, 180) in global user coordinates, not each shape's local center. Material overlays are clipped to their part, with later foreground parts covering the eye/background layers normally. Styles are deterministic and editable until acceptance.

## Colors

Each color field is an integer from 0 to 31 indexing the exact palette order in README.md. All colors are equally likely. Choices are independent, allow repetition, and have no contrast correction. Both eyes share one eye color, both irises share one iris color, and both pupils share one pupil color.

Once frozen, palette indices, names and hex values cannot be reassigned. Additional color capabilities would require a separately specified addition that respects the existing base colors.

## Name seed and the uburithm

The owner set the first 64 bits aside for the ubunym and named the official algorithm the uburithm. The approved text-seed flow hashes the complete text into DNA first, then directly initializes the name stream from the first 64 bits. See uburithm.md for the proposed exact SplitMix64 calculation. Existing naming rules are fixed; prototype text-seed mappings are not a compatibility promise for the new SHA-256-to-DNA mapping.

The reference procedure generates the six-letter nomen, selects an extra length from [2, 3, 4, 6], generates that word, selects its orientation, then generates the remaining 6 minus extra-length letters on the opposite side. It capitalizes each word's first letter and lowercases the rest. The complete name contains twelve letters across two or three words.

Before freezing: transcribe the exact SplitMix64 constants, wraparound arithmetic, output conversion, ordered alphabets and patterns, Y handling, vowel/consonant-pair restrictions and every draw into this specification. Never depend on Math.random, locale-sensitive case conversion or a mutable imported generator. A reference file or a reference to SplitMix64 alone is not a complete standard.

The 64-bit seed supplies repeated deterministic rolls, rather than assigning DNA bits to every letter decision. Different seeds may generate the same name. Reachability of every theoretical name is not claimed.

## Approved mouth corners

- Each pair roll succeeds when its four bits are all one: 6.25% per pair.
- If either pair succeeds, use only pair outcomes: cut both top corners if the top pair succeeds and both bottom corners if the bottom pair succeeds. Do not apply individual rolls in this branch.
- If neither pair succeeds, each individual corner roll succeeds when its four bits are all one: 6.25% per corner, conditional on this branch.
- Pair and individual rolls occupy permanent positions even when not used.
- These are roll probabilities, not final shape probabilities. A pair can also appear through two individual successes.
- Preserve the distinction between pair-branch and individual-branch outcomes as derived semantic data for descriptions. Do not carry the prototype's numeric '10'/'5' source labels into these new probabilities.

The owner retained the two-stage structure and revised the pair rolls from three bits to four. All six rolls now have a 6.25% success probability, with individual rolls applied only in the neither-pair branch.

## Mouth geometry

The owner replaced the old width roll with four ten-bit parameters (0-1023 each). Width ranges from one iris diameter to the outer span of both eyes. Curved mapping should work like the eye-displacement system. The other three numeric ranges below are proposed reasonable values, using the reference 360-by-360 canvas.

| Parameter | Value 0 | Value 511 (normal) | Value 1023 |
| --- | --- | --- | --- |
| Width | 61.4252 | 151.915 | 250.99 |
| Height | 26.50305 | 53.0061 | 79.50915 |
| Horizontal displacement | -12 | 0 | +12 |
| Vertical displacement | -12 | 0 | +12 |

Width endpoints use the owner-corrected iris radius 30.7126 and eye outer radius 48.3813 + 35.3374/2, with eye-center separation 208.94 - 90.05. Normal mouth center is (179.995, 254.0531) in global viewBox coordinates. Geometry is centered at that position before applying displacement. Proposed positive X is right and positive Y is down. Mouth movement is independent of eye movement.

The old five-category width distribution and its category-specific descriptions no longer apply. Preview corners retain 45-degree cuts of min(height/3, width/2), preventing narrow mouths from self-intersecting. All face geometry/materials are clipped to the outer radius-176 circle. Size, position and clipping remain subject to appearance review.

## Eye controls

Owner requirements:

- One ten-bit horizontal displacement and one ten-bit vertical displacement, shared by both eyes. Iris and pupil move together.
- Each field ranges from 0 to 1023; 511 means normal placement. Horizontal endpoints place the iris's left/right edge at the corresponding eye edge; vertical endpoints do the same for top/bottom.
- Use a curve favoring normal placement.
- Two separate ten-bit rolls each have a 1/1024 chance to flip the left eye's horizontal or vertical displacement respectively. These do not flip the right eye or change colors/textures.

The preview activates a flip only when its roll is 1023 (all bits one), consistent with mouth gates. It negates the decoded signed offset, rather than complementing the stored ten-bit value: 1023 minus 511 would become 512 and incorrectly move a neutral eye. Neutral zero is preserved. The two flip rolls are independent.

Owner clarification: the prototype's radius-34 iris extended beneath the ring only to hide an antialiasing seam; it was not a larger intended iris. Remove the hollow ring construction. Draw each eye as a solid filled disc of radius 66.05, then overlay the iris at radius 30.7126 (the former opening's radius), then its pupil. This leaves continuous eye color beneath the iris, with no background seam or separate opening. Retain the prototype pupil radius 17 as a proposal.

For a single displaced axis with the other centered, iris-to-eye edge contact occurs at center offset plus or minus (66.05 - 30.7126) = 35.3374. Iris and pupil move together over the eye disc. The preview scales combined X/Y offsets down radially only when their length exceeds 35.3374, so the entire iris remains inside the eye at diagonal extremes. Left-eye flips are applied afterward and preserve containment. This radial rule is a preview choice for owner review.

## Ubuquity

The owner assigned the final eight bits (248-255) to an unsigned integer, directly mapped to a grade. This is a separate DNA rating, not a calculated summary of textures or appearance. Preserve the raw value as well as the derived grade.

| Grade | Inclusive values | Count | Probability |
| --- | --- | --- | --- |
| B | 0-124 | 125 | 48.828125% |
| A | 125-199 | 75 | 29.296875% |
| A+ | 200-224 | 25 | 9.765625% |
| S | 225-239 | 15 | 5.859375% |
| S+ | 240-250 | 11 | 4.296875% |
| S++ | 251-255 | 5 | 1.953125% |

Probabilities assume uniform random DNA. No special visual effects, privileges or minting rules are implied by the grade.

## Preview centered curve

For a ten-bit value v, normalize to a signed t:

- v <= 511: t = (v - 511) / 511.
- v > 511: t = (v - 511) / 512.

Then use c = t * t * t. This is a cheap cubic curve with exact endpoints -1 and +1 and exact zero at 511. The unequal denominators accommodate the owner's chosen neutral code in an even-sized 1024-value range; this is not perfectly symmetric sampling.

For a displacement with range [-D, +D], offset = D * c. For size with minimum a, normal b and maximum d, use b + c * (b - a) for c <= 0, or b + c * (d - b) for c > 0. Thus dimensions concentrate around their normal values without losing endpoints. The curve and numeric ranges are proposals, not frozen DNA laws.

## Permanence and verification

- No future expansion. Do not let branch-dependent parsing shift field boundaries.
- Preserve all 32 bytes when saving, importing and exporting, regardless of understood features.
- All fields are populated, including values whose effects are currently invisible. No bits remain unassigned; existing meanings cannot be repurposed after acceptance.
- Changes to display scale may preserve geometry, but meaningful geometry, palette, name and probability changes cannot silently replace established laws.
- Store reference vectors before finalization for bit extraction, name outputs, probability boundaries, mouth branches and geometry. Review changes before accepting the permanent schema.

## Decisions needed next

1. Inspect demo.html, especially the fixed schema samples, and adjust texture styling, geometry, curve or allocations if needed.
2. Accept the implemented bit order, uburithm, rendering and numeric rules before freezing DNA.
3. Design the separately protected .ubu mint certificate after appearance review. The demo's unsigned import/export is only a local test envelope.

After these choices, finish the exact naming and geometry laws and review reference vectors before declaring any minted DNA permanent.

## Isolated verification

2026-10-23: node --check passed for ubu.js and demo.js. An isolated Node comparison matched 10,000 raw-state name outputs against the original ubunym procedure, with identical draw mechanics. Checks also covered exact text hashing (including empty input, leading zeros, whitespace and distinct Unicode sequences), 1,000 random DNA encode/decode round trips and geometry bounds, all 256 texture flag combinations for each part, every Ubuquity value, pair-branch precedence, individual cuts, neutral/flipped eyes and invalid/noncanonical DNA rejection. A signed-zero assertion initially failed for flipped neutral eyes; the decoder now returns positive zero and the checks pass. These are source/isolated checks, not a performance benchmark or owner appearance acceptance.

Browser preview: checked text-seed repeatability and leading-zero distinction, material samples, trait inspection, favorite saving, history navigation, invalid DNA errors and an unsigned export/import restoring the same DNA. The preview is served on loopback with only demo.html, demo.js and ubu.js exposed. Appearance acceptance and the permanent signed/encrypted envelope remain open.
