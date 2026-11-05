# Appearance Rarity

Appearance rarity is a deterministic, derived measurement of how unusual an ubu's expressed traits are. It does not alter the 1024-bit DNA specification, uburithm, trait probabilities, renderer behavior, or `.ubu` file formats.

Rarity is measured without querying the mint database or requiring a mint signature. The same DNA always receives the exact same rarity score.

## 1. Information-Theoretic Rarity Bits

Every complete 1024-bit DNA string has identical probability ($2^{-1024}$) under uniform generation. Appearance rarity measures unusual *expressed visual traits* using information-theoretic surprisal, with additional bounded visual refinements:

$$\text{surprisal}(p) = -\log_2(p)$$

Total appearance rarity is the sum of twelve scored components:

$$\text{bits} = \text{finishes} + \text{materialPreference} + \text{colors} + \text{harmony} + \text{contrast} + \text{corners} + \text{mouthCuts} + \text{eyelids} + \text{eyeFlips} + \text{geometry} + \text{featureGeometry} + \text{name}$$

The total is an interpretable rarity index in bits. It is not presented as a literal $1 \text{ in } 2^{\text{bits}}$ probability.

### Finishes
Each of the 5 body-part slots has a texture:
- Matte (default): probability $31/32$ ($\approx 0.0458$ bits)
- Each of the thirty-two assigned special materials: probability $1/1024$ ($10.0$ bits each).

Texture rotation angles are uniformly distributed and intentionally excluded.

**Material desirability** is separate from its probability: a rare finish adds +3 bits on background, +2.25 on eye rings, +1.5 on mouth, +0.75 on irises and +0 on pupils. Matte adds zero preference points. All rare finishes still have the same 1/1024 probability; the extra points are aesthetic weights.

### Colors
Individual palette colors are equally likely ($1/32$). Rarity derives from the number of distinct colors $k \in \{1..5\}$ across the 5 slots:

$$P(k) = S(5, k) \cdot \frac{32 \times 31 \times \dots \times (32 - k + 1)}{32^5}$$

where $S(5, k)$ are the Stirling numbers of the second kind (`[1, 15, 25, 10, 1]` for $k = 1..5$):
- 5 distinct colors: $\approx 0.474$ bits
- 4 distinct colors: $\approx 1.959$ bits
- 3 distinct colors: $\approx 5.496$ bits
- 2 distinct colors: $\approx 11.14$ bits
- 1 color (monochrome): $20.0$ bits

### Color harmony
A continuous **0–3-bit bonus** measures relationships between the distinct colors in all five roles. It refines (rather than replaces) the separate color-count score. This is a deliberately weighted visual-harmony index, not independent information-theoretic surprisal.

Indices 0–27 form a circular, approximate hue sequence. For two chromatic colors, let `d` be their shortest circular index distance (0–14). Their affinity is:

$$A(d) = \cos^2\left(\frac{\pi d}{14}\right)$$

Affinity is highest for closely related colors (`d` near 0) and complementary colors (`d` near 14), and fades smoothly toward quarter-wheel separation (`d = 7`). The wheel wraps from index 27 to 0.

Indices 28–31 are neutral (Alabaster, Slate, Gunmetal, Onyx). A chromatic–neutral pair receives affinity `0.4`; two distinct neutrals receive `0.7 + 0.1 × index distance`, recognizing graded light/dark contrast without treating neutral indices as chromatic hues.

Compute the mean affinity `Ā` across all unordered pairs of **distinct** colors. With `k` distinct colors, the bonus is:

$$\text{harmony} = 3 \times \frac{k-1}{4} \times \bar{A}^2$$

For `k=1`, harmony is zero: the 20-bit exact-match rarity already rewards a single-color palette. The `(k-1)/4` factor keeps highly repeated palettes from receiving another large bonus. The squared mean favors coherent palettes while allowing ordinary mixed colors to have a small, smoothly varying contribution; the maximum is 3 bits, substantially below a 10-bit rare finish.

### Perceptual color contrast
Contrast is sensitive to which visual layers use which colors, unlike slot-independent hue harmony. Fixed-palette sRGB hex values were converted once into CIELAB L* lightness. With `D(a,b)=((L*(a)-L*(b))/100)^2`, the weighted contrast score is:

`0.8 D(background,eyes) + 0.6 D(eyes,irises) + 0.5 D(irises,pupils) + 0.6 D(background,mouth)`

It ranges continuously from 0 to at most 2.5 bits. These are aesthetic weights, not extra event probabilities.

### Mouth corners
Scores the probability of the resulting visible 4-corner pattern, taking pair precedence into account. For $c$ cut corners and pattern mask:
- Individual rolls: $p = (15/16)^{6-c} \cdot (1/16)^c$
- If mask is top pair (`12`) or bottom pair (`3`), add $15/256$.
- If mask is all four corners (`15`), add $1/256$.
$$\text{cornerBits} = -\log_2(p)$$

For each active corner, add curvature surprisal: 2 bits for curved (1/4), or -log2(3/4) for straight. Inactive curvature rolls do not contribute.

### Central cuts and eyelids

An active lip notch also adds curvature surprisal: 2 bits for curved (1/4), or -log2(3/4) for straight. Inactive notch-curvature rolls do not contribute. Each independent central mouth cut contributes -log2(1/64) when present or -log2(63/64) when absent. Eyelid occurrence uses the same resulting-pattern probability as mouth corners. Active left-eye eyelids add the 1/1024 angle/depth-flip surprisal when the corresponding raw parameters differ from their neutral/equal values. This is a categorical index; it does not claim an exact probability of identical pixels. Lid geometry is not included in the geometry-tail component.

### Eye flips
Left-eye flip controls activate when raw displacement equals 1023 ($p = 1/1024$, contributing $10$ bits). Inactive flips contribute $-\log_2(1023/1024) \approx 0.00141$ bits.
- **Neutral exception:** If eye displacement raw equals 511, displacement is zero and the flip is invisible. That axis contributes $0$ bits regardless of flip flag.

### Continuous geometry
All six 10-bit mouth/eye parameters now contribute `0.4 × (-log2(tailProbability(v)))` throughout their range, replacing the old hard 5% tail threshold. Neutral values contribute 0; extreme endpoints contribute up to 3.6 bits per coordinate. For eye displacement, the score is attenuated if actual decoded travel in the left and right eyes is reduced by eyelids or radial containment.

### Expressed feature geometry
- **Mouth shape:** up to 0.65 bits for the squared absolute log-deviation of width/height from the normal ratio, normalized to reachable extremes.
- **Horizontal opening:** only when the opening exists, up to 0.65 bits for squared visible width fraction, capped at full mouth width.
- **Eyelids:** each active eye-specific lid receives `0.25 × ((angle/30)^2 + (depth/35.3374)^2)` bits, using the decoder's visible lid angles/depths. Inactive lids do not score their raw values.

These are small, continuously graded appearance modifiers, not literal independent rarity probabilities.

### Name structure
The visibility rules use joint word-count/length categories, scored once as `-log2(p)`. Placement before or after the nomen affects scoring only when both surrounding words are visible.

| Visible structure | Probability | Bits |
| --- | --- | --- |
| Nomen only | 5/16 | 1.678072 |
| Nomen + one 2-, 3- or 4-letter word | 3/8 | 1.415037 |
| Nomen + one 6-letter word | 1/8 | 3 |
| Praenomen Nomen Cognomen | 21/128 | 2.607683 |
| Praenomen Cognomen Nomen | 3/128 | 5.415037 |

The packed naming stream uses disjoint initial flag bits for visibility and 1/8 front placement. Two-word placement remains rarity-neutral. Already-empty slots stay empty. The new rules apply to all DNA, including existing issuance. Percentiles are recalibrated against 1,000,000 random 128-byte DNA samples. Existing issued sort scores are invalidated once and recalculated by bounded backfill. Existing assembled packs retain their contents/quintile labels; subsequent pack assembly uses the updated scores.

## 2. Calibrated Percentile (0–100)

Rarity bits map to a calibrated empirical percentile ($0.0$ to $100.0$) using a precomputed reference table generated from 1,000,000 uniformly random DNA samples (`scripts/calibrate-rarity.cjs` -> `rarity-table.json`).

The percentile represents approximately what percentage of uniformly generated ubus have equal or lower rarity score:

$$\text{percentile} = 100 \times \frac{\text{count}(\text{referenceBits} \le \text{bits})}{N}$$

Percentile lookup is monotonically non-decreasing.

## 3. Independence from Ubuquity

Ubuquity (grades C through UBU) is determined solely by the final ten DNA bits (1014–1023). Appearance rarity is completely separate from Ubuquity. Both are presented independently:
- **Ubuquity:** `UBU`
- **Appearance rarity:** `97.0 / 100` (`12.3 bits`)
