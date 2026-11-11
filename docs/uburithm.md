# The uburithm

The uburithm is the permanent naming algorithm for Ububall, implemented in `shared/ubu.js`. It features independent surrounding-word visibility rolls and front placement of visible cognomens (1/8 odds).

## Architecture

The generator in `shared/ubu.js` uses `NameRandom`, `word6`, `word` and `ubunym` with pre-cased weighted syllable and consonant-pair lookup tables.

## Fixed naming rules

- Generate a six-letter nomen, plus six letters split across praenomen/cognomen using the original procedure below. After generating every word, independently show each surrounding slot with probability 1/2. Hidden words are omitted, never redistributed; an originally empty slot remains empty. Names contain one to three visible words.
- Generate nomen first, then flag-selected extra and opposite words. The packed flag layout and chunk draw order below are authoritative.
- Title-case the generated ASCII words, retaining named slots even when a surrounding slot is empty. Join nonempty slots with one ASCII space.
- Ordinary vowels, in order: AEIOU.
- Consonants, in order: BCDFGHJKLMNPQRSTVWXYZ. Weighted distribution: standard 16 consonants have weight 6; K and Y have weight 3; Q has weight 2; X and Z have weight 1 (total pool weight 106). Y can also be a restricted vowel.
- Six-letter pattern order: CVCVCV, CVCVVC, CVVCCV, CVVCVC, VCCVCV, VCCVVC, VCVCCV, VCVCVC.
- For other required lengths (2, 3, 4), choose CV or VC for each two-letter block. An odd trailing position alternates with its previous position.
- VV draws from all 25 ordered ordinary-vowel pairs in vowel-major order, including doubles. Y cannot occupy either VV position.
- For other vowel positions, Y is allowed at a word edge, or between two single consonants if neither neighbor belongs to a CC run. At eligible positions each ordinary vowel has weight six and Y has weight one (thirty-one outcomes); otherwise draw from AEIOU.
- For CC, X may only follow one of HLNRSWYXZ. Immediately after VV, a CC pair cannot start with H, W or Y. Each allowed pair (c1, c2) is weighted by w(c1) × w(c2) across the complete ordered pair pool, rather than drawing the first and second characters independently.
- A standalone consonant immediately after VV cannot be Y.

## Packed naming stream

The packed generator replaces the former seed-to-name mapping for all DNA, including issued ubus. Letter weights, contextual rules, structural odds and the first 64-bit DNA seed remain unchanged. No DNA or certificate bytes change. Future optimizations must preserve this packed mapping.

### SplitMix64 and initial flags

Read DNA bits 0–63 as an unsigned, MSB-first 64-bit seed. For every mix:

1. Increment state by `0x9e3779b97f4a7c15` modulo 2^64.
2. Set `z = ((state XOR (state >> 30)) * 0xbf58476d1ce4e5b9)` modulo 2^64.
3. Set `z = ((z XOR (z >> 27)) * 0x94d049bb133111eb)` modulo 2^64.
4. Set `z = z XOR (z >> 31)`. Shifts are unsigned logical shifts.

Mix once at initialization. Let `lo` and `hi` be its low and high unsigned 32-bit halves. Reserve the low eight bits of `lo` as flags:

| Flag bits (least significant first) | Meaning |
| --- | --- |
| 0–1 | Extra length index into [2, 3, 4, 6] |
| 2 | Extra word before nomen when zero |
| 3 | Show praenomen when zero |
| 4 | Show cognomen when zero |
| 5–7 | Put visible cognomen immediately before nomen when all zero |

Initialize the quotient pool with `value = lo >>> 8`, `range = 2^24`. Queue `hi` as the first 32-bit refill. Later mixes supply high then low 32-bit halves, preserving unused halves between requests.

### Bounded integer draws

To draw `int(n)` in [0,n), repeat:

1. If `range < n`, append one queued 32-bit chunk: `value = value * 2^32 + chunk`, `range *= 2^32`.
2. Compute `limit = range - range % n`.
3. If `value < limit`, return `result = value % n`, retaining `value = (value - result) / n` and `range = limit / n`.
4. Otherwise subtract `limit` from both `value` and `range`, and retry, refilling if needed.

Use exact integer values in IEEE-754 binary64. The largest bound is 11,171, so refills keep values below 2^46, safely below the 2^53 exact-integer limit. Do not truncate the quotient to 32 bits. Rejection avoids modulo bias and quotient recycling retains unused randomness. Independence/unbiasedness describes ideal uniform source words; the deterministic 64-bit seed cannot supply unlimited mathematical independence. Rejection has no fixed maximum mix count.

### Weighted chunk tables and draw order

Construct tables using the alphabets and weights above. A cross product A×B iterates A outside B, preserving repeated weighted entries. Capitalize only the first letter of the assembled word; all other letters are lowercase. Define:

- C: weighted 106-entry consonant pool; C1: C without Y (103 entries).
- Y: weighted 31-entry vowel pool (six copies of each AEIOU, then Y); V: ordinary AEIOU.
- VV: all 25 ordered ordinary-vowel pairs, vowel-major order.
- CC: 11,171-entry weighted pair pool; CC1: 9,581-entry pool immediately after VV. First-character order is the consonant alphabet; second-character order is the permitted consonant alphabet. Repeat each pair by the product of character weights.
- CV = C×Y, VC = Y×C, CVV = C×VV, VVC1 = VV×C1, C1V = C1×Y, V5C = V×C.

For every six-letter word, draw `int(8)` then follow this table left to right. Each chunk is one bounded draw unless noted. Use a capitalized variant only for the first chunk.

| Pattern draw | Pattern | Chunk draws / assembly |
| --- | --- | --- |
| 0 | CVCVCV | CV + CV + CV |
| 1 | CVCVVC | CV + C + VVC1 |
| 2 | CVVCCV | CVV + CC1 + Y |
| 3 | CVVCVC | CVV + C1V + C |
| 4 | VCCVCV | Draw Y×Y once; first vowel + CC + V5C + second vowel |
| 5 | VCCVVC | Y + CC + VVC1 |
| 6 | VCVCCV | Draw V×Y once; VC + first vowel + CC + second vowel |
| 7 | VCVCVC | VC + VC + VC |

A two-letter word draws once from concatenated capitalized CV then VC tables (6,572 entries).

A three-letter word draws `int(2)`: zero selects CV + C; one selects VC + Y.

A four-letter word draws `int(4)`: zero selects CV + CV; one draws Y×Y once and assembles first vowel + CC + second vowel; two selects CVV + C1; three selects VC + VC.

Generate the six-letter nomen first, then the extra word of the flag-selected length, then an opposite word of length `6 - extraLength` unless zero. Assign slots using the orientation flag; apply visibility flags without redistributing letters. For a visible front cognomen, order slots P-C-N; otherwise P-N-C. Omit empty slots and join with one ASCII space. Set `cognomenBeforeNomen` true only when the cognomen is visible and its front flag succeeds.

## Verification and cost

`test/packed-name-vectors.json` captures outputs from the independently compiled benchmark candidate before promotion. `test/name-vectors.json` records historical outputs and is not rewritten. Production matched the benchmark candidate across 10,000 raw seeds; non-name decoded fields also matched the prior decoder. Protocol tests exercise quotient retention, rejection and large refills.

The optimization adds pre-cased lookup tables and startup work in exchange for reduced per-name CPU. The benchmark observed two mixes per name; this is not a guaranteed bound. `node scripts/bench-name-rolls.cjs` compares the saved historical naming baseline, combined flags, packed recycling and hybrid table variants using the current decoder/rarity code. Benchmark fixtures are never public assets.

Rarity uses the unchanged structural category probabilities. The changed mapping requires recalculating stored scores (revision 3) and recalibrating percentiles; existing assembled packs retain contents and quintile labels.
