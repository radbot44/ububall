# The uburithm

Frozen by owner acceptance on 2026-10-23 (America/New_York). ubu.js implements this permanent naming algorithm. Optimizations must preserve seed-to-name outputs and draw consumption.

## Source review

Reviewed the supplied standalone generator and uburoom's web/ubumfa.js. The relevant reference functions are patternForLength, vowelYAllowed, followsVowelPair, consonantPair, generateWord, randomForSeed and ubunym (ubunymParts in the standalone generator). Source comments and implementation details are evidence, not additional owner instructions.

## Fixed naming rules

- Six-letter nomen, plus six letters split across praenomen/cognomen; two or three nonempty words total.
- Generate nomen first. Select extra length from [2, 3, 4, 6], generate that word, select before/after orientation, then generate an opposite word of length 6 minus extra length unless that length is zero.
- Title-case the generated ASCII words, retaining named slots even when a surrounding slot is empty. Join nonempty slots with one ASCII space.
- Ordinary vowels, in order: AEIOU.
- Consonants, in order: BCDFGHJKLMNPQRSTVWXYZ. Y can also be a restricted vowel.
- Six-letter pattern order: CVCVCV, CVCVVC, CVVCCV, CVVCVC, VCCVCV, VCCVVC, VCVCCV, VCVCVC.
- For other required lengths (2, 3, 4), choose CV or VC for each two-letter block. An odd trailing position alternates with its previous position.
- VV draws from all 25 ordered ordinary-vowel pairs in vowel-major order, including doubles. Y cannot occupy either VV position.
- For other vowel positions, Y is allowed at a word edge, or between two single consonants if neither neighbor belongs to a CC run. At eligible positions each ordinary vowel has weight three and Y has weight one (sixteen outcomes); otherwise draw from AEIOU.
- For CC, X may only follow one of HLNRSWYXZ. Immediately after VV, a CC pair cannot start with H, W or Y. Draw across the complete allowed ordered pair list, rather than drawing the first and second characters independently.
- A standalone consonant immediately after VV cannot be Y.

## Permanent random stream

1. Read DNA bits 0-63 as one unsigned 64-bit initial state, most significant bit first. No string conversion or FNV seed hash.
2. For every draw, increment state by 0x9e3779b97f4a7c15 modulo 2^64.
3. Copy state to z. Set z = ((z XOR (z >> 30)) times 0xbf58476d1ce4e5b9) modulo 2^64.
4. Set z = ((z XOR (z >> 27)) times 0x94d049bb133111eb) modulo 2^64.
5. Let r = (z XOR (z >> 31)) >> 11, giving a nonnegative 53-bit integer. Logical shifts operate on unsigned values.
6. For an n-outcome draw, preserve the reference rule floor((r / 2^53) times n), using IEEE-754 binary64 in that operation order. Orientation is before when r / 2^53 < 0.5.

All 64-bit inputs, including zero, are valid. This reproduces the prototype stream mechanics from a raw initial state, not its original text-seed-to-state mapping. The finite outcome scaling is not mathematically uniform for non-power-of-two n; retaining it preserves the reference calculation. Do not substitute integer scaling or rejection sampling: those change the permanent mapping.

## Preserve the draw schedule

Within each word:

1. Draw the pattern (one draw for a six-letter pattern; one draw per two-letter block for the other required lengths).
2. Draw VV pairs from left to right.
3. Draw unfilled vowel positions from left to right.
4. Draw CC pairs from left to right.
5. Draw remaining consonants from left to right.

Between words, retain the reference order: nomen, extra length, extra word, orientation, opposite word. Do not collapse two pattern draws into one, move orientation ahead of word generation, or add a retry without recognizing that this changes the seed-to-name mapping.

## Efficiency review

The reference consonantPair function recalculates the number of allowed pairs and scans groups on every call. Precompute two ordered pair arrays once:

- Normal context: 429 ordered pairs.
- Immediately after VV: 366 ordered pairs.

Build each in exactly the reference order: first characters in their original alphabet order, second characters in the original allowed-second alphabet order. One draw with the original outcome count then directly indexes the array. This preserves the reference selection and draw count while avoiding repeated counting and scanning. The pair counts were checked with an isolated Node calculation.

Potential output-preserving optimizations:

- Precompute vowel-Y eligibility, VV/CC locations and post-VV consonant restrictions for every allowed pattern.
- Cache all 25 vowel pairs and weighted sixteen-outcome vowel choices.
- Reuse short immutable tables across names; do not precompute complete names or enormous name enumerations.
- Keep integer state arithmetic explicit. Do not replace the random stream for speed without reviewing the permanent mapping.

Names are short, so these are structural simplifications, not measured performance claims. The demo precomputes both consonant-pair arrays and the vowel-pair array, preserving the reference draw schedule. An isolated comparison of 10,000 raw-state seeds matched the original ubunym procedure. Pattern metadata remains calculated directly; no performance benchmark or claim of absolute optimality has been made.

## Compatibility

The exact stream, raw initial state and draw schedule are permanent. Text seeds hash through SHA-512 into complete DNA before naming. Run `node --test ubu.test.js`; fixed expected outputs must not be rewritten to approve a changed mapping.
