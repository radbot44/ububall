# CPU planning and simulation

The local CPU evaluates complete three-player plans through `ububallMatch.resolveTurn` (`fastSearch: true`, `fastTick: true`), using the canonical gameplay physics, 240 Hz timestep, 12-second turn cap (1 second in Pulse), explicit guard braking, supers, stun, and meter rules. It never receives the human's planned arrows or super arming choices, and judges every turn fresh without requiring match history so single-turn replays remain self-contained; on `hard` and above, optional resolved-turn `history` adapts opponent predictions to repeated setups (including alternating kickoff patterns) and offensive/defensive tendencies. Browser planning runs in a Web Worker from the public state captured at the start of the turn. Launch waits for that plan; a reset cancels old work. Worker failure or a ten-second timeout falls back to the heuristic planner.

The planner seeds search from the personality heuristic (`cpuPlans`). Its shot candidates include full-power open lanes, point-blank spin strikes, shots that curve around blockers, and board banks. For moving balls, `traceMovingBall` uses loose-ball physics to generate intercept candidates, including after rebounds. Coordinated plays include screen clears, Shockwave crease blasts, goalie knockouts, slot parks, Snap one-timers, Pack Draft breakaways, Rim-Around exits, wing breakouts, Magnet pulls, and Sticky drives and takedowns.

On defense, `assessOpponentThreat` estimates shot and cross-slot pass danger. The planner generates goal-line intercepts for incoming shots, Guard saves, and pocket coverage for a goalie with room under the crease allowance. Crease warnings and nearby teammates can shift coverage outside the crease. Candidate rollouts use match rules to evaluate whether a save or a crease violation occurs. Refinement focuses on skaters involved in the play and includes the goalie when a candidate concedes.

Multi-opponent presets use worst-case-aware screening (`bestMin`) and check execution wobble for close contenders. An early goal earns a tie-break bonus of up to 0.06% of the goal weight. When a Standard or Classic rollout reaches its horizon, `evaluateBodies` projects skater stopping slides and a six-substep, skater-aware ball coast. It scores discounted impending goals, crease warnings and cards, charged Super reserves, and positional features (`strikeAccess`, `coneCover`, `shotChance`). In Pulse, it uses end-of-turn positions and projects the ball’s carry-over velocity.

On Hard and above, the counter-search (`findCounter`) tests ball-path interceptions, goal-mouth blocks, checks on playmakers, and scoring replies such as far-post shots and Snap passes. It can reserve a finalist slot for a Guard or crease-pocket plan during an active threat. Insane and Ububall God use canonical `finishTurn` settlement to search a second turn when the first turn has no locked goal. Ububall God can search up to three turns in Pulse.

## Difficulty presets

Choose a CPU difficulty in **New match**. The initial default is Medium.

| Level | Label | Team candidates | Opponent scenarios | Horizon ticks |
| --- | --- | ---: | ---: | ---: |
| `easy` | Easy | 14 | 1 (Heuristic + live goal-line save) | 240 |
| `medium` | Medium | 48 | 2 (+ Guard brake / active threat shot) | 420 |
| `hard` | Hard | 84 | 3 (+ Open-corner sniper, striker check blitz, scoring-punish counter-search & history learning) | 500 |
| `insane` | Insane | 150 | 4 (+ Snap/curve rush, dual refine, counter-search, multi-pattern learning & 2-turn finalist look-ahead) | 580 |
| `god` | Ububall God | 240 | 4 (+ 720-tick rollout + 1.35s coast, dual wobble/refine, 2-round counter-search, dual-bridge 2-turn look-ahead & 3-turn Pulse chain) | 720 |
| `ballistic` | Ballistic | 240 | God scenarios and a learned response when distinct, with God counter-search and look-ahead | 720 |

Ballistic appears in **New match** once the browser worker loads compatible weights for the selected rules. It uses Ububall God's search budget, including the third Pulse turn, and adds candidate plays from the neural policy and a 55% neural blend for eligible positional evaluations. A saved Ballistic match can continue with Ububall God if the weights become unavailable. The other five presets use heuristic search by default, even when weights are installed.

Each candidate blends its average and worst outcome across the active opponent scenarios (`risk` weights in preset order are `.15`, `.35`, `.53`, `.55`, `.55`, `.55`), verifying execution `wobble` across all contenders within the final selection window. Final selection deduplicates quantized tactical basins (`planBasinKey`) before Boltzmann sampling (`temperature` values are `45`, `3.0`, `1.5`, `0.8`, `0.4`, `0.4`) so repeated local tweaks never drown out a sharp pass or bank shot. Team personality traits (`aggression`, `creativity`, `teamwork`, `clutch`) express style at equal strength through a bounded tie-break bias (`±8`) among near-optimal candidates rather than changing evaluation weights or risk tolerance.

## Run comparisons

From the repository root:

```powershell
npm run test:cpu
npm run sim:cpu -- --scenarios --a hard
npm run sim:cpu -- --scenarios --a god
npm run sim:cpu -- --games 5 --seed 1 --mode standard --a hard --b medium --output personal/cpu-standard.json
npm run sim:cpu -- --games 5 --seed 1 --mode standard --a god --b insane --trace --output personal/cpu-god.json
```

`--games` counts **pairs**: each seeded roster matchup runs twice, with sides swapped and each profile retaining its roster. Standard uses seeded DNA stats, personalities, loadouts and starting meters. Classic uses normal stats and no supers, retaining DNA personality. Both opponents plan independently from the same public state. Matches end at five goals or `--turns` (default 80). Capped matches are reported separately and never counted as wins on score alone. `legacy` selects the non-search heuristic planner, and `hold` supplies a stationary team.

Reports contain scores, wins, capped games, turn counts, simulation counts and mean/p95/maximum planning times. `--trace` records each turn's six moves, goal and physics tick count; seed, mode and side-swap flag reconstruct the starting state for replay. Keep experimental reports under ignored `personal/`.

## Compare rule weights and budgets

Pass `--config personal/cpu-experiment.json` with an `a` and/or `b` profile. Each can be a preset name (`easy`, `medium`, `hard`, `insane`, `god`, `ballistic`) or an object:

```json
{
  "a": {
    "level": "insane",
    "candidates": 160,
    "opponents": 4,
    "lookaheadTop": 4,
    "lookaheadBudget": 56,
    "risk": 0.55,
    "weights": { "goal": 10000, "progress": 1, "access": 0.35, "cover": 0.30, "meter": 0.35 }
  },
  "b": "hard"
}
```

Omitted values inherit the preset and default weights in `shared/ububall-cpu.js`. Candidate counts are bounded to 1–1000, opponent scenarios to 1–5, `lookaheadTop` to 0–20, `lookaheadBreadth` to 2–8, `lookaheadTicks` to 60–2880, `lookaheadBudget` to 0–400, `pulseDepth` to 1–3, `screenTop` to 1–1000, risk to 0–1 and weights to nonnegative finite values.

## Measure stat value

`scripts/stat-balance.cjs` and `scripts/ability-benchmark.cjs` play CPU-vs-CPU matches in parallel worker threads to measure stat swings and calibrate Ability Scores:

```powershell
npm run sim:stats -- --experiment sweep --pairs 20 --output personal/stat-sweep.json
npm run sim:stats -- --experiment regression --pairs 600 --seed 1001 --output personal/stat-regression.json
npm run sim:stats -- --experiment sweep --stats spin,curve,synergy,chemistry --pairs 40 --level medium
```

- **sweep:** for each stat, a team with it at 0 and at 255 on all three ubus (others neutral) plays an all-neutral team. Reports goal difference per match with a 95% interval and the win rate of decided matches; the swing (255 minus 0) ranks the stats.
- **regression:** every stat on every ubu is random. A least-squares fit of each pair's goal difference on the teams' average stat differences gives every stat's value at once, as goal difference per +128 team-average edge, with a 95% interval. It also absorbs interactions the sweep holds fixed.

Options: `--pairs`, `--seed`, `--level` (CPU preset, default `easy` for throughput), `--turns` (cap per match, default 60), `--threads`, `--stats` (comma-separated subset), `--output`. Results depend on how well the CPU uses each stat; confirm a ranking with a smaller `--level medium` run before acting on it. Keep reports under ignored `personal/`.

CPU search calls `resolveTurn` with `effects: false`, which skips presentation-only work (hit-stop look-aheads and the replay's starting snapshot) without changing any rule. In `fastSearch: true`, `cloneFastSkater` and `cloneFastBall` pre-populate a uniform body shape across all turns so V8 monomorphic caches stay intact after Turn 0 dynamic state transitions.

## Validation notes

The CPU suite checks reproducibility, search budgets, tactical fixtures, and planning across all six difficulty levels. The shooting and goaltending fixtures resolve selected plans through the match engine, including Pulse rebounds, Cannonball threats, Guard saves, and screened bank shots. The neural suite also trains a temporary v2 model and uses it to plan a Ballistic turn.

## Study policy moves from the same position

```powershell
node scripts/nn-policy-study.cjs --standard web/assets/ububall-net-standard.bin --pulse web/assets/ububall-net-pulse.bin --seeds 2 --out personal/nn-policy-study
```

The study samples seeded God, pure-policy, and Ballistic games and includes tactical fixtures. It tests each plan against the same set of opponent replies and compares goal outcomes. Scoreless Pulse branches get a second turn with the same heuristic continuation for both sides. A position ties when its goal difference summed across replies is equal. The report keeps cards, crease warnings, final ball position and the moves for each case. The ablations compare Ballistic with its own policy, opponent policy, or value head disabled one at a time. Policy lineage tracks direct proposals and refinements in the single-skater sweep and local fine-tuning. The report includes importable `.ububall` clips for the clearest policy gains and losses.

## Train and run the Path 1 neural evaluator and policy

`shared/cpu/nn.js`, `scripts/nn-generate.cjs`, and `scripts/train-nn.py` implement UBNN format 2. The default float16 residual network uses a `315 -> 256 -> 256 -> 256` trunk with LayerNorm and SiLU, a three-way next-goal value head, and an 18-output policy head. The observation includes all 15 skater stats, personality, current and next-turn stun, Super state, and ball striker and Sticky offset fields. Each side is encoded with `+x` as the attack direction, skaters in `[attack, support, defend]` order, and angles as `(cos, sin)`. Training applies vertical reflection to the signed observation and policy channels.

```powershell
# 1. Generate v2 binary training shards across CPU worker threads (335 float32s / 1,340 B per row)
npm run nn:gen:quick
npm run nn:gen -- --matches 1200 --preset mixed --mode mixed --out personal/nn-shards-v2

# 2. Train on RTX 4090 (VRAM-resident CUDA bf16 PyTorch) and export web/assets/ububall-net.bin
python scripts/train-nn.py --shards personal/nn-shards-v2 --epochs 25 --batch-size 4096

# 3. Compare Ballistic or pure policy head-to-head against heuristic presets
npm run sim:cpu -- --games 10 --threads 1 --mode standard --nn-weights web/assets/ububall-net.bin --a ballistic --b god
npm run sim:cpu -- --games 10 --mode pulse --a "{\"level\":\"hard\",\"nn\":\"only\",\"weightsPath\":\"web/assets/ububall-net.bin\"}" --b medium
```

To train separate models, generate one dataset per mode and export each checkpoint to its own asset:

```powershell
foreach ($mode in @('standard', 'pulse')) {
    npm run nn:gen -- --matches 2000 --turns 70 --preset mixed --mode $mode --out "personal/nn-$mode-shards"
    if ($LASTEXITCODE -ne 0) { break }
    python scripts/train-nn.py --shards "personal/nn-$mode-shards" --epochs 25 --batch-size 4096 --out "web/assets/ububall-net-$mode.bin" --report "personal/nn-$mode-report.json"
    if ($LASTEXITCODE -ne 0) { break }
}
```

Any ruleset with Pulse uses `ububall-net-pulse.bin`. Other rulesets use `ububall-net-standard.bin`. If that specialist is missing or incompatible, the browser tries the general `ububall-net.bin`. To compare a specialist with parallel simulator workers, set `weightsPath` on the Ballistic profile and pass the matching `--mode`.

Regenerate v1 shards before training v2. The trainer requires the v2 shard manifest, and the worker requires a v2 model with the current physics version and finite weights. After training, restart `npm run dev` to copy the model assets to the public directory, then reload the game.
