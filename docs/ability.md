# Core Stat Ability Score

`Ability Score` (`shared/ability.js`) is the gameplay-effectiveness analogue to `Appearance Rarity` (`shared/rarity.js`). It is a deterministic, derived measurement of how strong an ubu's **15 core gameplay stats** (DNA bits `374–493`) are across a **50% Standard / 50% Pulse** match mix with active DNA personalities.

Like Appearance Rarity, Ability Score does not alter the 1024-bit DNA schema, physics rules, `.ubu` certificates, or Mint pack/starter assembly. The same 15 core stats always receive the exact same Ability Score, independent of visual traits, unlocked supers, personality bits, Ubuquity grade, or mint metadata.

## 1. Spline + Physics-Interaction Model (`score`)

Because Ububall's 240 Hz physics contain hard thresholds and coupled trade-offs—such as `baseReach = max(baseRadius, reach)` shadowing `Reach` whenever `Reach <= Size`, the ~890 px/s fireball ignition cliff, the 15% free-daze threshold, `Size`'s negative launch/agility/board exponents, and squared Super-stat multipliers (`Efficiency² × Synergy² × Chemistry²`)—a single linear weight per stat misprices specialized ubus.

`scoreAbility(model)` evaluates a 72-parameter empirical utility model in units of **Expected Goal Differential per Match (Value Above Neutral)**:

1. **15 × 5-Knot Piecewise-Linear Splines (`[0, 64, 127.5, 191, 255]`):** Each stat's curve is anchored at `0` at neutral (`127.5`), capturing diminishing returns, convex super scaling, and non-monotonic trade-offs across Movement (`Impulse`, `Traction`, `Spin`, `Curve`), Physical (`Size`, `Mass`, `Bounciness`, `Grip`), Engagement (`Power`, `Reach`, `Strength`, `Stability`), and Super (`Efficiency`, `Synergy`, `Chemistry`).
2. **12 Physics-Coupled Pairwise Interactions:**
   - `reach_over_size`: exact hinge `max(0, (reach - size) / 255)` capturing unshadowed poke-check extension beyond body radius.
   - Normalized centered cross-products (`z_a × z_b`, where `z = (raw - 127.5) / 127.5`): `size_x_reach`, `impulse_x_power`, `impulse_x_size`, `size_x_mass`, `mass_x_stability`, `strength_x_mass`, `spin_x_curve`, `spin_x_grip`, `traction_x_impulse`, `efficiency_x_synergy`, and `power_x_curve`.

## 2. Calibrated Empirical Percentile (`0.00` to `100`)

Raw `score` maps to an empirical percentile (`0.0` to `100.0`) via binary search and linear interpolation over `TABLE` (`shared/ability-table.json`, 1,001 thresholds in `0.1%` steps generated from 1,000,000 uniformly random 128-byte DNA samples). Display formatting shares `ubuList.rarityScore(percentile)` (`XX.XX` up to `99.00`, expanding precision past leading `9`s above `99` so elite stat rolls stay distinguishable).

## 3. High-Certainty Calibration Workflow (Multi-Core CPU + GPU)

### Step 1: Simulate Checkpointed Match Corpus (Node 22+ `worker_threads`)

Run `scripts/ability-benchmark.cjs` (`npm run sim:ability`). It spawns persistent workers across all logical threads minus two (e.g. 30 threads on an i9-14900K), alternates `Standard` (80-turn cap) and `Pulse` (240-turn cap) 50/50, keeps DNA personalities active, initializes real Ubuquity `0–100%` starting meters, equips highest-mastery unlocked supers, and streams append-only `.jsonl` rows so runs can stop (`Ctrl+C`) and `--resume` at any time:

```powershell
# High-certainty full suite (~25,000+ side-swapped pairs = 50,000+ matches)
npm run sim:ability -- --suite full --preset balanced --pairs 20000 --curve-pairs 150 --inter-pairs 80 --wild-pairs 2000 --threads 30 --output personal/ability-corpus.jsonl

# Faster iteration preset (28 candidates, 2 opponent scenarios, wobble off)
npm run sim:ability -- --suite full --preset fast --pairs 10000 --threads 30 --output personal/ability-corpus.jsonl
```

### Step 2: Fit Splines, Verify on GPU Oracle & Bootstrap 95% CIs, and Rebuild Quantiles

With Python + PyTorch (CUDA on RTX 4090) available, run the full statistical fitter (trains a GPU permutation-invariant neural oracle to measure the held-out $R^2$ ceiling, runs 5-fold CV + 1,000× bootstrap resampling for 95% CIs, writes `shared/ability-model.json` and `personal/ability-fit-report.json`, and invokes `calibrate-ability.cjs`):

```powershell
python scripts/fit-ability.py --input personal/ability-corpus.jsonl --bootstraps 1000
```

Or fit and recalibrate the 1,000,000-DNA quantile table directly in zero-dependency Node:

```powershell
npm run calibrate:ability -- --corpus personal/ability-corpus.jsonl
```
