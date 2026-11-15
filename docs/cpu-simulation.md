# CPU planning and simulation

The local CPU evaluates complete three-player plans through `ububallMatch.resolveTurn` (`fastSearch: true`, `fastTick: true`), using the canonical gameplay physics, 240 Hz timestep, 12-second turn cap (1 second in Pulse), explicit guard braking, supers, stun, and meter rules. It never receives the human's planned arrows or super arming choices, and judges every turn fresh without requiring match history so single-turn replays remain self-contained; on `hard` and above, optional resolved-turn `history` adapts opponent predictions to repeated setups and tendencies. Browser planning runs in a Web Worker from the public state captured at the start of the turn. Launch waits for that plan; a reset cancels old work. Worker failure or a ten-second timeout falls back to the heuristic planner.

The planner seeds search from the personality heuristic (`cpuPlans`), then builds a coordinated three-player play portfolio (`jointTeamPlays`): open-aperture goal aiming (`scanGoalAperture`), goalie screen-clearing checks paired with simultaneous sniper shots, synchronized Tape-to-Tape `Snap` one-timers, `Pack Draft` slipstream breakaways, corner `Rim-Around` exits, dynamic shot-cone goalie coverage (`shotConePoint`, always outside the 80 px crease), and dedicated `Sticky` ball-carrier drives and takedowns. Search interleaves single-skater options by tactical intent, then spends its refinement budget in a two-gear (coarse-to-fine) perturbation loop concentrating edits on skaters that actively participate in the rollout (`activeMask`).

To maximize tactical strength per simulation, multi-opponent presets use a quick first-pass `r = 0` gate plus inline challenger wobble: obvious duds are dropped after a single rollout against an apples-to-apples baseline reference, while contenders run full multi-opponent vetting and execution `wobble` inline (preventing fragile 1-px flukes or own-goal traps from hijacking hill-climbing). When a Standard or Classic rollout truncates at its tick horizon, `evaluateBodies` projects 4-substep curved ball coast and skater stopping slides (including post-horizon crease-camping warnings and cards) and scores antisymmetric positional features (`strikeAccess`, `coneCover`, `shotChance`) alongside `WEIGHTS` (`chance: 200`, `access: 0.7`, `cover: 0.6`).

On `hard`, `insane`, and `god`, top distinct tactical basins also run a bounded adversarial counter-search (`findCounter`, 1–2 rounds) to uncover opponent punishes that static scenario presets miss.

## Difficulty presets

Choose a CPU difficulty in **New match**. The initial default is Medium.

| Level | Label | Team candidates | Opponent scenarios | Horizon ticks |
| --- | --- | ---: | ---: | ---: |
| `easy` | Easy | 14 | 1 (Heuristic) | 240 |
| `medium` | Medium | 48 | 2 (+ Guard brake) | 420 |
| `hard` | Hard | 84 | 3 (+ Open-corner sniper, striker check blitz & counter-search) | 500 |
| `insane` | Insane | 150 | 4 (+ Multi-attacker rush, dual-skater refine & counter-search) | 580 |
| `god` | Ububall God | 240 | 4 (+ Full 720-tick vision, dual wobble, dual refine & 2-round counter-search) | 720 |

Each candidate blends its average and worst outcome across the active opponent scenarios (`risk` weights: `.15`, `.35`, `.53`, `.55`, `.55`). Final selection deduplicates quantized tactical basins (`planBasinKey`) before Boltzmann sampling (`temperature`: `45`, `3.0`, `1.5`, `0.8`, `0.4`) so repeated local tweaks never drown out a sharp pass or bank shot. Team personality traits (`aggression`, `creativity`, `teamwork`, `clutch`) express style at equal strength through a bounded tie-break bias (`±8`) among near-optimal candidates rather than changing evaluation weights or risk tolerance. DNA and game physics are unchanged.

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

Pass `--config personal/cpu-experiment.json` with an `a` and/or `b` profile. Each can be a preset name (`easy`, `medium`, `hard`, `insane`, `god`) or an object:

```json
{
  "a": {
    "level": "insane",
    "candidates": 160,
    "opponents": 4,
    "risk": 0.55,
    "weights": { "goal": 10000, "progress": 1, "access": 0.35, "cover": 0.30, "meter": 0.35 }
  },
  "b": "hard"
}
```

Omitted values inherit the preset and default weights in `shared/ububall-cpu.js`. Candidate counts are bounded to 1–1000, opponent scenarios to 1–5, `screenTop` to 1–1000, risk to 0–1 and weights to nonnegative finite values.

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

In isolated Node 22 benchmarks (`sim:cpu`, Standard mode) on this development machine:
- `medium` beat `easy` 4–0 (seeds 1–2, both sides, 0 capped; `medium` mean 169–189 ms/turn, `easy` mean 13–31 ms/turn).
- `hard` beat `medium` 5–1 (seeds 1–3, both sides, 0 capped; `hard` mean 416–468 ms/turn, `medium` mean 178–226 ms/turn).
- `god` beat `hard` 3–1 (seeds 1–2, both sides, 0 capped; `god` mean 1195–1421 ms/turn, `hard` mean 307–413 ms/turn).
