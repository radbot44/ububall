# CPU planning and simulation

The local CPU evaluates complete three-player plans through `ububallMatch.resolveTurn` (`fastSearch: true`, `fastTick: true`), using the canonical gameplay physics, 240 Hz timestep, 12-second turn cap (1 second in Pulse), explicit guard braking, supers, stun, and meter rules. It never receives the human's planned arrows or super arming choices, and judges every turn fresh without requiring match history so single-turn replays remain self-contained; on `hard` and above, optional resolved-turn `history` adapts opponent predictions to repeated setups (including alternating kickoff patterns) and offensive/defensive tendencies. Browser planning runs in a Web Worker from the public state captured at the start of the turn. Launch waits for that plan; a reset cancels old work. Worker failure or a ten-second timeout falls back to the heuristic planner.

The planner seeds search from the personality heuristic (`cpuPlans`), then builds a coordinated three-player play portfolio (`jointTeamPlays`) alongside single-skater options: open-aperture goal aiming (`scanGoalAperture`), goalie screen-clearing checks and `Shockwave` crease blasts paired with simultaneous sniper shots, two-turn goalie-knockout slot parks and wing-space chips, synchronized Tape-to-Tape `Snap` one-timers, `Pack Draft` slipstream breakaways, corner `Rim-Around` exits, coordinated two-skater defensive fire drills and wing breakouts, non-contact `Magnet` fly-by pulls and slot yanks, dynamic shot-cone goalie coverage (`shotConePoint`, always outside the 80 px crease), and dedicated `Sticky` ball-carrier drives and takedowns. Search interleaves single-skater options by tactical intent, then spends its refinement budget in a two-gear (coarse-to-fine) perturbation loop concentrating edits on skaters that actively participate in the rollout (`activeMask`).

To maximize tactical strength per simulation, multi-opponent presets use a worst-case-aware `r = 0` gate (`bestMin` cap so one-sided blunders never prune plays that beat guarding goalies) plus inline challenger wobble (`ensureWobbled`). When a Standard or Classic rollout truncates at its tick horizon, `evaluateBodies` projects curved skater stopping slides and a 6-substep skater-aware ball coast—stopping blocked shots at goalies while awarding discounted impending-goal equity when an unobstructed ball crosses the open goal mouth after the cutoff—alongside post-horizon crease-camping warnings/cards, charged 100-meter Super reserve equity, and antisymmetric positional features (`strikeAccess`, `coneCover`, `shotChance`) weighted by `WEIGHTS` (`chance: 200`, `access: 0.7`, `cover: 0.6`). In Pulse mode, `evaluateBodies` keeps skater and ball positional features synchronized at turn-end coordinates while projecting carry-over ball velocity and unstoppable imminent goal-mouth crossings.

On `hard`, `insane`, and `god`, top distinct tactical basins run a trajectory-aware adversarial counter-search (`findCounter`, 1–2 rounds) targeting ball-path midpoints, goal-mouth plugs, and active playmakers, and re-verify any newly promoted runner-up basin with execution `wobble`. On `insane` and `god`, whenever no forced Turn-1 goal is already locked, top distinct finalists bridge through canonical `finishTurn` settlement (`preservePartial: false`: applying knockout stuns, penalty cards, expired Standard supers, 25% whiff refunds, and carried Pulse momentum/supers) into a bounded simultaneous-move Turn-2 micro-game (`lookaheadTop`, `lookaheadBreadth`, `lookaheadBudget`), with `god` chaining up to 3 continuous turns (`pulseDepth: 3`) in Pulse mode.

## Difficulty presets

Choose a CPU difficulty in **New match**. The initial default is Medium.

| Level | Label | Team candidates | Opponent scenarios | Horizon ticks |
| --- | --- | ---: | ---: | ---: |
| `easy` | Easy | 14 | 1 (Heuristic) | 240 |
| `medium` | Medium | 48 | 2 (+ Guard brake) | 420 |
| `hard` | Hard | 84 | 3 (+ Open-corner sniper, striker check blitz, trajectory counter-search & history learning) | 500 |
| `insane` | Insane | 150 | 4 (+ Multi-attacker rush, dual refine, counter-search, multi-pattern learning & 2-turn finalist look-ahead) | 580 |
| `god` | Ububall God | 240 | 4 (+ 720-tick rollout + 1.35s coast, dual wobble/refine, 2-round counter-search, dual-bridge 2-turn look-ahead & 3-turn Pulse chain) | 720 |

Each candidate blends its average and worst outcome across the active opponent scenarios (`risk` weights: `.15`, `.35`, `.53`, `.55`, `.55`), verifying execution `wobble` across all contenders within the final selection window. Final selection deduplicates quantized tactical basins (`planBasinKey`) before Boltzmann sampling (`temperature`: `45`, `3.0`, `1.5`, `0.8`, `0.4`) so repeated local tweaks never drown out a sharp pass or bank shot. Team personality traits (`aggression`, `creativity`, `teamwork`, `clutch`) express style at equal strength through a bounded tie-break bias (`±8`) among near-optimal candidates rather than changing evaluation weights or risk tolerance. DNA and game physics are unchanged.

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
    "lookaheadTop": 4,
    "lookaheadBudget": 56,
    "risk": 0.55,
    "weights": { "goal": 10000, "progress": 1, "access": 0.35, "cover": 0.30, "meter": 0.35 }
  },
  "b": "hard"
}
```

Omitted values inherit the preset and default weights in `shared/ububall-cpu.js`. Candidate counts are bounded to 1–1000, opponent scenarios to 1–5, `lookaheadTop` to 0–20, `lookaheadBreadth` to 2–8, `lookaheadBudget` to 0–400, `pulseDepth` to 1–3, `screenTop` to 1–1000, risk to 0–1 and weights to nonnegative finite values.

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

In isolated Node benchmarks (`sim:cpu`), all 17 CPU suites pass (`Medium` averaging ~108 simulations/turn and `Hard` ~213 simulations/turn across tactical fixtures). Selective 2-turn look-ahead (`Insane` and `Ububall God`) adds ~30–100 bounded short rollouts per non-terminal turn and defeated the 1-turn `Insane` planner 3–1 (`17–12` goals) in swapped-side Pulse matches and `8–5` in swapped-side Standard matches.
