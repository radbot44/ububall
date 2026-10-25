# Ubu DNA specification

Owner-approved replacement schema, 2026-10-25 (America/New_York). DNA is exactly 512 bits. Previous 256-bit beta ubus are obsolete and rejected, with no conversion or compatibility path. Assigned fields have fixed positions; later additions may use only the unassigned bits. All sixteen assigned materials have distinct rendering patterns.

## Input and representation

- Text: encode the exact string with TextEncoder (UTF-8, no BOM, unpaired surrogates replaced by U+FFFD), then SHA-512 to the complete 64-byte DNA. Preserve case, leading zeros, whitespace and Unicode code-point sequences; no normalization. Empty text is valid.
- Random: generate all 64 bytes using platform cryptographic randomness. Ordinary minting generates its own random DNA.
- Imported DNA: preserve all 64 bytes directly, including unassigned bits. Never rehash imported DNA.
- Number bits 0–511, first byte first and most significant bit first in every byte and field. All bit patterns are valid.
- Canonical unpadded base64url is exactly 86 characters, with zero unused encoding padding bits. The designer also accepts exactly 128 hexadecimal characters; .ubu files accept only canonical base64url.
- DNA equality compares all 64 bytes. Ownership, mint identity, serials, signatures and timestamps remain outside DNA.

## Block layout

| Inclusive bits | Width | Purpose |
| --- | --- | --- |
| 0–63 | 64 | Ubunym seed |
| 64–81 | 18 | Background attributes |
| 82–99 | 18 | Eye attributes |
| 100–117 | 18 | Iris attributes |
| 118–135 | 18 | Pupil attributes |
| 136–153 | 18 | Mouth attributes |
| 154–157 | 4 | Top mouth-pair roll |
| 158–161 | 4 | Bottom mouth-pair roll |
| 162–165 | 4 | Top-left mouth-corner roll |
| 166–169 | 4 | Top-right mouth-corner roll |
| 170–173 | 4 | Bottom-left mouth-corner roll |
| 174–177 | 4 | Bottom-right mouth-corner roll |
| 178–187 | 10 | Mouth width |
| 188–197 | 10 | Mouth height |
| 198–207 | 10 | Mouth horizontal displacement |
| 208–217 | 10 | Mouth vertical displacement |
| 218–227 | 10 | Iris/pupil horizontal displacement percentage |
| 228–237 | 10 | Iris/pupil vertical displacement percentage |
| 238–247 | 10 | Left-eye horizontal displacement flip roll |
| 248–257 | 10 | Left-eye vertical displacement flip roll |
| 258–261 | 4 | Top eyelid-pair roll |
| 262–265 | 4 | Bottom eyelid-pair roll |
| 266–269 | 4 | Top-left eyelid roll |
| 270–273 | 4 | Top-right eyelid roll |
| 274–277 | 4 | Bottom-left eyelid roll |
| 278–281 | 4 | Bottom-right eyelid roll |
| 282–291 | 10 | Top eyelid angle |
| 292–301 | 10 | Top eyelid depth |
| 302–311 | 10 | Bottom eyelid angle |
| 312–321 | 10 | Bottom eyelid depth |
| 322–331 | 10 | Left-eye eyelid angle flip roll |
| 332–341 | 10 | Left-eye eyelid depth flip roll |
| 342–343 | 2 | Top-left mouth-corner curvature |
| 344–345 | 2 | Top-right mouth-corner curvature |
| 346–347 | 2 | Bottom-left mouth-corner curvature |
| 348–349 | 2 | Bottom-right mouth-corner curvature |
| 350–355 | 6 | Top-center lip-notch roll |
| 356–361 | 6 | Horizontal mouth-cut roll |
| 362–371 | 10 | Horizontal mouth-opening width |
| 372–373 | 2 | Lip-notch curvature roll |
| 374–501 | 128 | Unassigned; preserve in full |
| 502–511 | 10 | Ubuquity |

64 + 90 + 24 + 40 + 40 + 24 + 40 + 20 + 8 + 12 + 10 + 2 + 128 + 10 = 512.

## Body-part attributes

Each 18-bit slot starts at bit 64 + 18 × slot index (0–4).

| Relative bits | Meaning |
| --- | --- |
| 0–4 | Color index, 0–31 |
| 5–7 | Material angle, 0–7 mapping to 0°, 45°, …, 315° |
| 8–12 | Material gate, active only for 31 (all ones) |
| 13–17 | Material selector, 0–31 |

An inactive gate means default matte regardless of selector. A successful gate selects exactly one material: any special material is 1/32 per part; each particular material is 1/1024. The selector order is:

| Selector | Material |
| --- | --- |
| 0 | Metallic |
| 1 | Glossy |
| 2 | Iridescent |
| 3 | Crystalline |
| 4 | Pearlescent |
| 5 | Marble |
| 6 | Velvet |
| 7 | Frosted |
| 8 | Terrazzo |
| 9 | Crackle |
| 10 | Holographic |
| 11 | Woodgrain |
| 12 | Plush |
| 13 | Lacquered |
| 14 | Damascus |
| 15 | Opalescent |
| 16 | Satin |
| 17 | Leather |
| 18 | Denim |
| 19 | Carbon Fiber |
| 20 | Hammered Metal |
| 21 | Granite |
| 22 | Sandstone |
| 23 | Obsidian |
| 24 | Liquid |
| 25 | Bubbled |
| 26 | Mosaic |
| 27 | Circuitry |
| 28 | Quartz |
| 29 | Kintsugi |
| 30 | Lava |
| 31 | Starfield |

All thirty-two material patterns are implemented in the shared renderer. Granite (21) adds a dense, multiscale mineral matrix with restrained stone shading; satin (16) adds subtle silky fibers with broad curved drape highlights and a soft directional sheen; sandstone (22) adds dense fine sandy grain with subtle continuous sediment layers and matte shading; starfield (31) adds deep nebula clouds, starry pinpricks, and sparkle diffraction spikes; quartz (28) adds translucent hexagonal crystal prism formations with internal fractures and pale refractive glints; obsidian (23) adds dark glassy shading with broad curved shell-like fracture surfaces and restrained lip glints; mosaic (26) adds individually shaded polygonal tiles with contrasting recessed grout lines; hammered metal (20) adds repoussé shallow dimples with localized specular highlights; kintsugi (29) adds dark irregular glaze fractures repaired with gleaming molten gold seams; leather (17) adds fine, closely packed irregular pebbled grain with recessed channels and restrained highlights; carbon fiber (19) adds a tight 2x2 twill checker weave with alternating reflective strand bands; denim (18) adds a fine 3/1 diagonal twill weave with pale weft threads peeking through palette-colored warp, inset hems and double stitching along the face-part boundaries (small pupils use a hem only); bubbled (25) adds overlapping translucent spherical bubbles with iridescent rims and specular crescents; lava (30) adds charred basalt crust plates separated by glowing incandescent magma rivers; circuitry (27) adds orthogonal PCB conductive traces with solder pads and glowing LED status nodes; liquid (24) adds flowing fluid streamlines and refractive light caustic convergence ripples. Pearlescent (4) adds a soft pastel sheen; marble (5) adds branching stone veins; lacquered (13) adds deep shading and sharp polished reflections; damascus (14) adds contrasting etched alloys with polished steel luster and irregular turbulent bands. Velvet (6) adds continuous textured nap with an extreme matte finish and no directional sheen; frosted (7) adds a cool haze with branching ice crystals; holographic (10) adds repeating spectral reflections and fine diffraction grooves; woodgrain (11) adds long fibers bending around a fixed knot, retaining the palette color as the stain. Terrazzo (8) adds scattered stone chips; crackle (9) adds a connected jagged glaze-crack network with chipped edges; plush (12) replaces the former Silken finish with overlapping soft curls and deep pile, as requested by the owner; its selector and rarity remain unchanged; opalescent (15) adds milky depth with scattered soft color patches. These rendering additions do not change any DNA assignments. Rotate designed materials about the global outer-circle center (180, 180), clockwise in SVG coordinates. Default matte has fixed zero orientation. Fixed procedural detail must not consume DNA or uburithm draws. Interactive lighting is presentation only; thumbnails remain static.

## Colors

Each color field is an integer from 0 to 31 indexing the exact palette order in README.md. All colors are equally likely. Choices are independent, allow repetition, and have no contrast correction. Both eyes share one eye color, both irises share one iris color, and both pupils share one pupil color.

The palette indices, names and hex values in README.md are permanent. No additional color capabilities are planned.

## Name seed and the uburithm

The owner set the first 64 bits aside for the ubunym and named the official algorithm the uburithm. The approved text-seed flow hashes the complete text into DNA first, then directly initializes the name stream from the first 64 bits. See uburithm.md for the permanent SplitMix64 calculation. Existing naming rules are fixed; prototype text-seed mappings are not a compatibility promise for the new SHA-512-to-DNA mapping.

The reference procedure generates the six-letter nomen, selects an extra length from [2, 3, 4, 6], generates that word, selects its orientation, then generates the remaining 6 minus extra-length letters on the opposite side. It capitalizes each word's first letter and lowercases the rest. The complete name contains twelve letters across two or three words.

The exact SplitMix64 calculation, alphabets, patterns, contextual restrictions and draw order are specified in uburithm.md. Never depend on Math.random, locale-sensitive case conversion or a mutable imported generator. A reference file or a reference to SplitMix64 alone is not a complete standard.

The 64-bit seed supplies repeated deterministic rolls, rather than assigning DNA bits to every letter decision. Different seeds may generate the same name. Reachability of every theoretical name is not claimed.

## Pair/individual rolls

Mouth corners and eyelids independently use the same structure. Each four-bit roll succeeds only for 15 (1/16). If either pair roll succeeds, use only the pair results: both top positions and/or both bottom positions. Otherwise apply the four individual rolls. Position order is top-left, top-right, bottom-left, bottom-right. Preserve pair versus individual source information. Inactive rolls never shift parsing.

## Mouth geometry and cuts

The normal mouth center is (179.995, 254.0531) in the reference 360×360 viewBox. Positive X is right and positive Y is down. Use the centered cubic below for sizes/displacements.

| Parameter | Value 0 | Value 511 | Value 1023 |
| --- | --- | --- | --- |
| Width | 61.4252 | 151.915 | 250.99 |
| Height | 26.50305 | 53.0061 | 79.50915 |
| X displacement | -12 | 0 | +12 |
| Y displacement | -12 | 0 | +12 |

Active corners cut equal distances along adjacent edges, with distance min(height/3, width/3). The width cap leaves the middle third available for the independent central cuts. A curvature roll of 3 gives a quadratic curve through the original square corner as control point; 0–2 give a straight diagonal. This is 1/4 curved conditional on that corner appearing, independently per corner.

The top lip-notch and horizontal-cut rolls each succeed only for 63, independently (1/64 each, four times rarer than a corner occurrence roll).

- Lip notch: one centered cut with depth `d = min(height/4, width/6)` and half-width d. Straight sides run at exactly 45° from (centerX-d, topY) through (centerX, topY+d) to (centerX+d, topY). The width cap keeps the notch clear of corner cuts even on narrow, tall mouths. Bits 372–373 independently select curvature: 3 means curved (1/4), 0–2 mean straight (3/4), conditional on the notch appearing. The curved variant replaces the two straight sides with a single quadratic between the same endpoints, using the triangular apex (centerX, topY+d) as control point; its endpoint tangents are 45° and its midpoint depth is d/2. Inactive curvature bits remain preserved.
- Horizontal opening: rectangular cut centered in the mouth, height/4 high. Bits 362–371 encode a linear width ratio `0.1 + raw/1023`, spanning 10%–110% of mouth width. Values 921–1023 give a fully open horizontal band. Rendering caps the removed width at the silhouette edges, so oversized cuts cannot add fill outside the mouth. The stored ratio retains the complete 110% endpoint. The width field has no visible effect unless the horizontal-cut occurrence roll succeeds. Its top is 3height/8 below the mouth's top edge, leaving height/8 of material below the deepest lip-notch points. Both variants may occur together.
- Openings reveal the underlying layers; do not paint them with a substitute background color.

## Eyes and eyelids

Solid eye discs have radius 66.05, centered at (120.55, 145.5) and (239.44, 145.5). Iris radius is 30.7126; pupil radius is 17. Iris/pupil share a center and move together. All face layers are clipped to the radius-176 outer circle centered at (180, 180).

Eyelid angle is 30° × centered cubic(raw), spanning -30° to +30°, neutral at 511. Depth is linear: (66.05 - 30.7126) × raw/1023, from a tangent at depth zero to a line tangent to the centered iris at maximum depth. These limits keep a full iris feasible even with both lids at maximum depth.

For angle a and side s (-1 top, +1 bottom), the visible half-plane in eye-local coordinates is:

`(-s sin(a)) x + (s cos(a)) y <= 66.05 - depth`.

Intersect the active half-planes with the solid eye disc. Both eyes normally share top/bottom depths, but their eyelid angles are mirrored: the left eye uses the negated right-eye angle for each lid. A left-eye angle flip negates those default mirrored angles, making them match the right eye; a left-eye depth flip swaps the top/bottom depths, preserving which lids are active. Each flip succeeds only for ten-bit value 1023 (1/1024), independently.

Displacement fields decode through the centered cubic into percentages px, py in [-1, +1]. Left-eye displacement flips negate the respective signed percentage, each only for roll 1023. Neutral zero stays zero. For each eye separately:

1. Let length = hypot(px, py), direction = (px, py)/length. Zero length gives zero displacement.
2. Begin with maximum center travel 35.3374 (eye radius minus iris radius).
3. For each active lid with outward unit normal n and distance d, if n·direction > 0, limit travel to (d - iris radius)/(n·direction).
4. Offset = direction × travel × min(1, length).

This uses the available opening after lids/flips and contains the entire iris (and therefore the smaller pupil), including diagonal extremes. No lids reproduces the previous radial bounds.

## Ubuquity

Read the final ten bits as an unsigned integer, independently of appearance rarity.

| Values | Grade | Label |
| --- | --- | --- |
| 0–299 | C | Blue (#477AE7) |
| 300–599 | B | Green (#42C66B) |
| 600–749 | A | Red (#EE4455) |
| 750–899 | S | Orange (#FF9954) |
| 900–999 | S+ | Orange with pink trim |
| 1000–1020 | U | Pink (#FF7197) |
| 1021–1023 | UBU | Pink with orange trim |

The owner assigned 900 to S+ and 1000 to U. Grade population counts are 300, 300, 150, 150, 100, 21, 3 out of 1024.

## Centered curve

For a ten-bit value v, normalize to a signed t:

- v <= 511: t = (v - 511) / 511.
- v > 511: t = (v - 511) / 512.

Then use c = t * t * t. This is a cheap cubic curve with exact endpoints -1 and +1 and exact zero at 511. The unequal denominators accommodate the owner's chosen neutral code in an even-sized 1024-value range; this is not perfectly symmetric sampling.

For a displacement with range [-D, +D], offset = D * c. For size with minimum a, normal b and maximum d, use b + c * (b - a) for c <= 0, or b + c * (d - b) for c > 0. Thus dimensions concentrate around their normal values without losing endpoints. The curve and numeric ranges are permanent. Use IEEE-754 binary64 for geometry. Conformance checks allow 1e-10 units of floating-point rounding tolerance without changing the specified mapping.

## Verification and scope

Tests cover exact SHA-512 text conversion, all material gate/selector outcomes, all 1024 ratings, pair precedence, corner curvature, independent mouth cuts, eyelid flips, iris containment at extremes, byte preservation and rejection of obsolete beta DNA. Accepted raw-seed uburithm names remain in test/name-vectors.json; text-to-name mappings change because whole-DNA hashing changed.

The .ubu profile, mint storage and signed issuance use the same complete 64-byte DNA. Previous beta files are rejected, never padded or reinterpreted. Existing production state is not automatically migrated or reset by this code change; installation/deployment and mint resets remain separately authorized operations.
