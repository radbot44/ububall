# Appearance Rarity

Appearance rarity is a deterministic, derived measurement of how unusual an ubu's expressed traits are. It does not alter the 512-bit DNA specification, uburithm, trait probabilities, renderer behavior, or `.ubu` file formats.

Rarity is measured without querying the mint database or requiring a mint signature. The same DNA always receives the exact same rarity score.

## 1. Information-Theoretic Rarity Bits

Every complete 512-bit DNA string has identical probability ($2^{-512}$) under uniform generation. Rarity therefore measures the improbability of an ubu's *expressed visual traits*, using information-theoretic surprisal:

$$\text{surprisal}(p) = -\log_2(p)$$

Total appearance rarity is the sum of eight scored components:

$$\text{bits} = \text{finishes} + \text{colors} + \text{corners} + \text{mouthCuts} + \text{eyelids} + \text{eyeFlips} + \text{geometry} + \text{name}$$

The total is an interpretable rarity index in bits. It is not presented as a literal $1 \text{ in } 2^{\text{bits}}$ probability.

### Finishes
Each of the 5 body-part slots has a texture:
- Matte (default): probability $63/64$ ($\approx 0.0227$ bits)
- Each of the sixteen assigned special materials: probability $1/1024$ ($10.0$ bits each). Pending material designs are scored by their assigned IDs, even while they display default matte.

Texture rotation angles are uniformly distributed and intentionally excluded.

### Colors
Individual palette colors are equally likely ($1/32$). Rarity derives from the number of distinct colors $k \in \{1..5\}$ across the 5 slots:

$$P(k) = S(5, k) \cdot \frac{32 \times 31 \times \dots \times (32 - k + 1)}{32^5}$$

where $S(5, k)$ are the Stirling numbers of the second kind (`[1, 15, 25, 10, 1]` for $k = 1..5$):
- 5 distinct colors: $\approx 0.474$ bits
- 4 distinct colors: $\approx 1.959$ bits
- 3 distinct colors: $\approx 5.496$ bits
- 2 distinct colors: $\approx 11.14$ bits
- 1 color (monochrome): $20.0$ bits

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

### Geometry tails
Measures extreme values in the 6 ten-bit geometry fields (mouth width, height, horizontal/vertical displacement, eye horizontal/vertical displacement). Ordinary variations receive 0 bonus; values in the most extreme 5% accumulate tail bonuses:

$$\text{geometryBits}(v) = \max\left(0, \log_2\left(\frac{0.05}{\text{tailProbability}(v)}\right)\right)$$

### Name structure
The uburithm produces 2-word names ($p = 1/4$, contributing $2$ bits) or 3-word names ($p = 3/4$, contributing $\approx 0.415$ bits).

## 2. Calibrated Percentile (0–100)

Rarity bits map to a calibrated empirical percentile ($0.0$ to $100.0$) using a precomputed reference table generated from 1,000,000 uniformly random DNA samples (`scripts/calibrate-rarity.cjs` -> `rarity-table.json`).

The percentile represents approximately what percentage of uniformly generated ubus have equal or lower rarity score:

$$\text{percentile} = 100 \times \frac{\text{count}(\text{referenceBits} \le \text{bits})}{N}$$

Percentile lookup is monotonically non-decreasing.

## 3. Independence from Ubuquity

Ubuquity (grades C through UBU) is determined solely by the final ten DNA bits (502–511). Appearance rarity is completely separate from Ubuquity. Both are presented independently:
- **Ubuquity:** `UBU`
- **Appearance rarity:** `97.0 / 100` (`12.3 bits`)
