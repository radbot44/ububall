# Core Stat Ability Score

`Ability Score` (`shared/ability.js`) is the gameplay-effectiveness analogue to `Appearance Rarity` (`shared/rarity.js`). It is a deterministic, derived measurement of how strong an ubu's **15 core gameplay stats** (DNA bits `374–493`) are across a **50% Standard / 50% Pulse** match mix with active DNA personalities.

Like Appearance Rarity, Ability Score does not alter the 1024-bit DNA schema, physics rules, `.ubu` certificates, or Mint pack/starter assembly. The same 15 core stats always receive the exact same Ability Score, independent of visual traits, unlocked supers, personality bits, Ubuquity grade, or mint metadata.

## 1. Physics-Equivariant Spline + Interaction Model (`score`)

Calibrated on **11,940 side-swapped pairs (`23,880` full matches, `1.64M` turns, `660.7M` 240 Hz physics ticks = `764.7` hours of simulated Ububall)**, `scoreAbility(model)` evaluates a 72-parameter empirical utility model in units of **Expected Goal Differential per Match (Value Above Neutral)**:

1. **15 × 5-Knot Piecewise-Linear Splines (`[0, 64, 127.5, 191, 255]`):**
   - Each stat's curve is anchored at `0` at neutral (`127.5`), regularized via 5-fold cross-validated second-difference smoothness (`R² = 0.1353`, `r = 0.3679`, exceeding an unconstrained permutation-invariant neural network `R² = 0.1290`, and predicting **69.04%** of decided winners on 900 out-of-sample wild 128-byte DNA pairs with unmirrored supers, personalities, and Ubuquity).
   - **Exact `Reach` Physics Equivariance (`REACH_FLOOR = 25.321928`):** Because `shared/ububall-physics.js` computes `baseReach = Math.max(baseRadius, 25 * multiplier(reach), 18)`, `raw.reach` has identically zero physical effect whenever `raw.reach <= Math.max(raw.size, 25.321928)`. `scoreAbility` evaluates `perStat.reach = g(effReach) - g(baseReachFloor)` where `effReach = max(size, reach, REACH_FLOOR)` and `baseReachFloor = max(size, REACH_FLOOR)`, guaranteeing identical Ability Scores for physically indistinguishable shadowed `Reach` rolls while rewarding unshadowed poke-check reach (`+0.389` above neutral size, up to `+0.584` on compact skaters).
   - **Shape-Constrained Monotonicity:** Purely beneficial physical/meter stats (`Impulse`, `Traction`, `Mass`, `Power`, `Reach`, `Strength`, `Stability`, `Efficiency`, `Synergy`, `Chemistry`) enforce non-decreasing knot slopes, while trade-off stats (`Size`, `Bounciness`, `Curve`, `Spin`, `Grip`) remain free to capture negative or non-monotonic mechanics (e.g. smaller skaters gaining faster launch `sizeMult^-0.35` and sharper re-steering `sizeMult^-0.70`, and lower `Bounciness` avoiding wide wall ricochets).
2. **12 Physics-Coupled Pairwise Interactions:**
   - `reach_ext_x_size`: `((effReach - baseReachFloor) / 255) * ((size - 127.5) / 127.5)`.
   - Normalized centered cross-products (`z_a × z_b`, where `z = (raw - 127.5) / 127.5`): `power_x_mass`, `impulse_x_power`, `impulse_x_size`, `size_x_mass`, `mass_x_stability`, `strength_x_mass`, `spin_x_curve`, `spin_x_grip`, `traction_x_impulse`, `efficiency_x_synergy`, and `power_x_curve`.

### Empirical 23,880-Match Stat Hierarchy (`255` vs `0` Goal-Diff Swing, 95% Bootstrap CI)

| Stat | 50/50 Swing (±95% CI) | Standard | Pulse | Primary Gameplay Mechanism |
| :--- | :--- | :--- | :--- | :--- |
| `Impulse` | `+1.149 ± 0.078` | `+0.811` | `+1.498` | Launch speed (`+1.15` goals & `+4.87` checks/ubu/game) |
| `Power` | `+0.605 ± 0.079` | `+0.460` | `+0.748` | Concave shot/fireball threshold & clearing punch (strongest on Anchor) |
| `Reach` | `+0.584 ± 0.147` | `+0.236` | `+0.346` | Unshadowed ball contact radius (`+0.389` above `Size = 127`; `0` when `≤ Size`) |
| `Traction` | `+0.251 ± 0.075` | `+0.278` | `+0.282` | Crisp positional stopping & stronger Guard brake in both modes |
| `Mass` | `+0.245 ± 0.076` | `+0.149` | `+0.354` | Momentum transfer on shots/checks without launch-speed penalty |
| `Stability` | `+0.176 ± 0.072` | `+0.101` | `+0.220` | Check recoil & Daze resistance + Iron Save `R` threshold |
| `Size` | `-0.173 ± 0.093` | `-0.238` | `-0.474` | Small skaters launch/re-steer faster (`-0.62` goals vs `+0.40` saves at `255`) |
| `Strength` | `+0.134 ± 0.077` | `+0.049` | `+0.175` | Opponent knockback & Daze infliction (`+4.27` checks/ubu/game) |
| `Efficiency` | `+0.111 ± 0.063` | `+0.072` | `+0.151` | Convex `multiplier²` super meter gain above `127` (`+0.055` with `Synergy`) |
| `Bounciness` | `-0.062 ± 0.072` | `-0.046` | `-0.067` | High board restitution bounces defenders further out of position |
| `Curve` | `-0.056 ± 0.075` | `-0.042` | `-0.081` | Residual collision spin bends straight-line chases in continuous Pulse |
| `Spin` | `-0.027 ± 0.079` | `+0.054` | `-0.095` | Helps Standard point-blank Spin Strikes (`+0.054`), drifts in Pulse (`-0.095`) |
| `Synergy` | `+0.010 ± 0.044` | `+0.023` | `-0.039` | Teammate meter share (`+0.055` interaction when `Efficiency` is high) |
| `Grip` | `-0.010 ± 0.073` | `+0.015` | `+0.001` | Near-neutral tangent spin/slip trade-off |
| `Chemistry` | `+0.001 ± 0.042` | `-0.026` | `+0.015` | Near-neutral passive teammate meter reception |

## 2. Calibrated Empirical Percentile (`0.00` to `100`)

Raw `score` maps to an empirical percentile (`0.0` to `100.0`) via binary search and linear interpolation over `TABLE` (`shared/ability-table.json`, 1,001 thresholds in `0.1%` steps generated from 1,000,000 uniformly random 128-byte DNA samples). Display formatting shares `ubuList.rarityScore(percentile)` (`XX.XX` up to `99.00`, expanding precision past leading `9`s above `99` so elite stat rolls stay distinguishable). `isCharged(input)` (`percentile >= CHARGED_PERCENTILE`, `90`) identifies top-decile Ability ubus for Charged Pack stages (`0`–`5`) and Mint reveal effects without altering pack assembly.

## 3. High-Certainty Calibration Workflow

```powershell
# Quick check (1,440 pairs), default calibration (4,316 pairs), or deep overnight pass (11,940 pairs)
npm run sim:ability:quick
npm run sim:ability
npm run sim:ability:deep

# Fit physics-equivariant splines + 95% bootstrap CIs and rebuild 1,000,000-DNA quantile table
python scripts/fit-ability.py --input personal/ability-corpus.jsonl --bootstraps 400
# Or in zero-dependency Node:
npm run calibrate:ability -- --corpus personal/ability-corpus.jsonl
```
