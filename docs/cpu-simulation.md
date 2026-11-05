# CPU planning and simulation

The local CPU evaluates complete three-player plans through `ububallMatch.resolveTurn`, using the gameplay physics, 240 Hz timestep, 12-second turn cap (1 second in Pulse), explicit guard braking, supers, stun and meter rules. It never receives the human's planned arrows or super arming choices. Browser planning runs in a Web Worker from the public state captured at the start of the turn. Launch waits for that plan; a reset cancels old work. Worker failure or a ten-second timeout falls back to the previous heuristic planner.

The existing heuristic supplies the initial plan and preserves personality-dependent role selection. Search tries direct shots at different powers and goal positions, defensive holds and clears, banks and spin based on creativity, point-blank spin strikes when within two ball diameters, body checks targeting primary opposing threats, wrap-around recoveries when ahead of the ball, defensive crease exits when warned for goal camping, and paired pass/receiver moves based on teamwork. It evaluates whole teams, then refines angle/power/spin and tries a few joint alternatives. Armed and unarmed candidates are compared when a super is available. DNA and game physics are unchanged.

## Initial difficulty presets

Choose a CPU difficulty in **New match**. The initial default is Medium. These are tuning presets, not a guarantee that a higher level wins every matchup.

| Level | Team candidates | Opponent scenarios | Maximum turn simulations |
| --- | ---: | --- | ---: |
| Easy | 18 | Heuristic | 18 |
| Medium | 60 | Heuristic, defensive guard braking | 120 |
| Hard | 120 | Heuristic, defensive guard braking, backside-aware attack | 360 |

Each candidate uses a blend of its average and worst outcome across the scenarios. The worst-outcome weight is .15/.35/.55 respectively. Evaluation prioritizes goals, then ball advancement, relative ball access, defensive coverage, meter, stuns and daze slow. In addition to the heuristic seed, team personality traits (`aggression`, `creativity`, `teamwork`, `clutch`) and match pressure modulate evaluation weights and risk tolerance dynamically. Multi-touch passing goals benefit from high roster teamwork by mitigating complexity decay. Search can override the seed when simulated outcomes are better.

## Run comparisons

From the repository root:

```powershell
npm run test:cpu
npm run sim:cpu -- --scenarios --a hard
npm run sim:cpu -- --games 5 --seed 1 --mode classic --a medium --b legacy --output personal/cpu-classic.json
npm run sim:cpu -- --games 5 --seed 1 --mode standard --a hard --b medium --trace --output personal/cpu-standard.json
```

`--games` counts **pairs**: each seeded roster matchup runs twice, with sides swapped and each profile retaining its roster. Standard uses seeded DNA stats, personalities, loadouts and starting meters. Classic uses normal stats and no supers, retaining DNA personality. Both opponents plan independently from the same public state. Matches end at five goals or `--turns` (default 80). Capped matches are reported separately and never counted as wins on score alone. `legacy` selects the previous CPU, and `hold` supplies a stationary team.

Reports contain scores, wins, capped games, turn counts, simulation counts and mean/p95/maximum planning times. `--trace` records each turn's six moves, goal and physics tick count; seed, mode and side-swap flag reconstruct the starting state for replay. Timings depend on the machine and concurrent load; moves and outcomes are reproducible for the same code/config/seed. Keep experimental reports under ignored `personal/`.

The tactical suite reports open shots, imminent goal threats, screened shots and corner recovery against both held and heuristic opponents. Focused tests assert open-shot conversion and avoiding a conceded goal in the defensive fixture; the other fixtures are diagnostic comparisons, not claims that every tactical problem is solved.

## Compare rule weights and budgets

Pass `--config personal/cpu-experiment.json` with an `a` and/or `b` profile. Each can be a preset name or an object:

```json
{
  "a": {
    "level": "hard",
    "candidates": 180,
    "opponents": 3,
    "risk": 0.65,
    "weights": { "goal": 10000, "progress": 1, "access": 0.35, "cover": 0.5, "meter": 0.35 }
  },
  "b": "hard"
}
```

Omitted values inherit the preset and default weights in `shared/ububall-cpu.js`. Config profiles override `--a`/`--b`. Candidate counts are bounded to 1–1000, opponent scenarios to 1–3, risk to 0–1 and weights to nonnegative finite values. Use identical seed ranges, both sides and both modes when comparing changes. Validate changes on additional seeds not used for tuning. Avoid treating repeated kickoff wins or a small sweep against the old CPU as proof of a balanced difficulty ladder.

The search is one turn deep. It does not yet model a human's habits, optimize multi-turn combinations, or prove that a pass is received. It judges those candidate plays by their simulated team outcome. A Standard or Classic search truncated at two seconds evaluates an in-flight physics snapshot without applying end-of-turn stopping, super expiry or fouls; completed turns still receive normal cleanup. More search is not guaranteed to improve results against every unseen opponent.

## Measure stat value

`scripts/stat-balance.cjs` plays CPU-vs-CPU matches through `resolveTurn` to measure how much each ubu stat is worth. Matches run in parallel worker threads (all cores but two by default) and are reproducible from their seed. Each pairing is played twice with sides swapped and the pair's goal difference averaged, so side advantage cancels; supers, personalities and starting meter are random per seed but mirrored between the teams.

```powershell
npm run sim:stats -- --experiment sweep --pairs 20 --output personal/stat-sweep.json
npm run sim:stats -- --experiment regression --pairs 600 --seed 1001 --output personal/stat-regression.json
npm run sim:stats -- --experiment sweep --stats size,reach --pairs 40 --level medium
```

- **sweep:** for each stat, a team with it at 0 and at 255 on all three ubus (others neutral) plays an all-neutral team. Reports goal difference per match with a 95% interval and the win rate of decided matches; the swing (255 minus 0) ranks the stats.
- **regression:** every stat on every ubu is random. A least-squares fit of each pair's goal difference on the teams' average stat differences gives every stat's value at once, as goal difference per +128 team-average edge, with a 95% interval. It also absorbs interactions the sweep holds fixed.

Options: `--pairs`, `--seed`, `--level` (CPU preset, default `easy` for throughput), `--turns` (cap per match, default 60), `--threads`, `--stats` (comma-separated subset), `--output`. Results depend on how well the CPU uses each stat; confirm a ranking with a smaller `--level medium` run before acting on it. Keep reports under ignored `personal/`.

CPU search calls `resolveTurn` with `effects: false`, which skips presentation-only work (hit-stop look-aheads and the replay's starting snapshot) without changing any rule.

## Baseline validation

These initial match results predate the collision-energy fix. They are historical baseline measurements, not win-rate claims for the corrected physics. Re-run comparisons when tuning levels against the updated engine.

With the initial presets, Medium beat legacy in 6/6 Classic matches (seeds 1–3, both sides) and 4/4 Standard matches (seeds 1–2, both sides). Medium beat Easy 4/4 and Hard beat Medium 4/4 in Standard (seeds 1–2, both sides). None hit the turn cap. These small, in-sample comparisons establish a useful starting point, not calibrated human difficulty or a reliable population win rate.

On this development machine, three fresh Standard kickoff samples (seeds 20–22) took approximately 27–77 ms for Easy, 152–168 ms for Medium and 403–487 ms for Hard in Node. Full-match positions were slower: Medium game-average planning times were approximately 480–768 ms in the baseline comparisons, and Hard averaged 1.8–2.5 seconds in its Medium matchups (game p95 values 2.5–3.1 seconds). These runs overlapped other local checks. Measure on target browsers/devices before increasing budgets. The planner and browser worker/client add about 10.4 KB of uncompressed source, with no new dependencies; candidate simulations run sequentially and retain only the best team plan, not a search tree.
