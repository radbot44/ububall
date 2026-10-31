# Ububall Design & 1024-Bit DNA Specification

Ububall is a 3v3 simultaneous-turn physics hockey game played on a curved-corner rink.

Match rules (owner decision 2026-10-29): Ububall plays with DNA stats and supers. Classic, Pulse and Blitz are independent rules that combine freely; `shared/ububall-match.js` implements them.
- **Classic:** every ubu uses default stats and has no supers.
- **Blitz:** 5 seconds to plan each turn.
- **Pulse:** a turn ends after 1 second of simulation (or a goal, or a settled field) instead of waiting for the field to settle. Momentum carries into the next turn. Launches use the normal impulse but steer toward the arrow's velocity (owner decision 2026-10-29): the change in velocity is capped at one full launch, so an ubu's own launches can turn or brake it but never push it past its full-launch speed; only collisions and supers can. From rest this equals an ordinary launch, so turns that start settled are unaffected. A launch with no power leaves the ubu coasting. Supers can be armed on any turn and last that turn. The last ball touch carries across turns for goal credit.

Guarding is an explicit choice in every mode: tap the selected ubu again (or use Guard) to guard instead of launching; the first tap only selects it. Guarding keeps the ubu's arrow, faded, so tapping again brings the launch back. A guarding ubu stays on guard into the next turn of the same round until it is tapped off or re-aimed; a kickoff clears it. A guarding ubu keeps its defensive bonuses for the turn and brakes sharply (initial tuning, not an owner decision: it keeps 25% of its velocity and spin when the turn starts). An ubu with no launch and no guard coasts. A knocked-out (stunned) ubu is simply frozen for its turn: it cannot guard.

## 1. 1024-Bit DNA Block Layout (128 Bytes Total)

Canonical unpadded base64url encoding is exactly 171 characters (or 256 hexadecimal characters).

```
[Bits    0–373: 374 bits] Visual Traits & Identity (Preserved from original specification)
[Bits  374–493: 120 bits] 15 Core Physical & Game Stats (8 bits each: 0–255)
[Bits  494–509:  16 bits] 4 Special Ability Slots (4 bits each: 0–15)
[Bits  510–533:  24 bits] AI Tactical Brain / Personality (4 axes @ 6 bits: 0–63)
[Bits  534–597:  64 bits] Voice & Goal Fanfare Suite (Synthesizer + 8-Note Melody)
[Bits 598–1013: 416 bits] Unassigned Reserve (52 bytes of headroom for future expansion)
[Bits 1014–1023: 10 bits] Ubuquity (Starting Special Meter %: 0–1023)
```

$$\text{Total} = 374 + 120 + 16 + 24 + 64 + 416 + 10 = \mathbf{1024 \text{ bits}}$$

---

## 2. Core Physical & Game Stats (Bits 374–493: 120 Bits)

Every stat is stored as an 8-bit unsigned integer (`0–255`, neutral `127`) and evaluated through an exponential multiplier curve, so each stat point changes the result by the same percentage (owner decision 2026-10-30, replacing the flatter centered cubic): below neutral $m = (2/3)^{(127-raw)/127}$, above $m = 1.5^{(raw-127)/128}$. Reference points: $0 = 2/3\times$, $64 \approx 0.82\times$, $127 = 1.0\times$, $191 \approx 1.22\times$, $255 = 1.5\times$.

| Category | Stat | Bits | Width | Values | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Movement** | `Impulse` | 374–381 | 8 | 0–255 | Engine thrust / launch speed ceiling |
| | `Traction` | 382–389 | 8 | 0–255 | Braking deceleration on ice, over a narrower span than most stats (multiplier^0.7, 0.75–1.33×; tuning) |
| | `Spin` | 390–397 | 8 | 0–255 | Maximum launch rotation rate |
| | `Curve` | 398–405 | 8 | 0–255 | Bends the ubu's own path, and the path of the ball after it strikes it; multiplies the spin a spin strike passes to the ball (still counter-rotating) |
| **Physical** | `Size` | 406–413 | 8 | 0–255 | Physical collision radius. Size trade-offs (tuning, powers of the size multiplier in `SIZE`): smaller ubus launch faster (^−0.28), curve more and re-steer a moving launch more (^−0.5), and strike spin harder (^−0.5); bigger ubus lose more speed off the boards (^−0.5). |
| | `Mass` | 414–421 | 8 | 0–255 | Body weight and collision momentum, over a narrower span than other stats (the square root of the multiplier, 0.82–1.22×; tuning). It does not slow the launch (full-launch speed comes from Impulse alone), so a heavier ubu shoots and checks harder and is harder to knock away; only Colossus's added weight slows a launch. Ubus have no air drag; the ball does. |
| | `Bounciness` | 422–429 | 8 | 0–255 | How much speed the ubu keeps off the boards (0.82 × multiplier, capped at 0.95, before the size loss). Body and ball contacts use one fixed rebound (0.88). |
| | `Grip` | 430–437 | 8 | 0–255 | Contact friction and spin transfer |
| **Engagement** | `Power` | 438–445 | 8 | 0–255 | Velocity transfer to the ball (shot power) |
| | `Reach` | 446–453 | 8 | 0–255 | Ball-only intercept/poke-check radius |
| | `Strength` | 454–461 | 8 | 0–255 | Check momentum delivered into opponents, which also deepens dazes (below) |
| | `Stability` | 462–469 | 8 | 0–255 | Resistance to checks and momentum loss, and to dazes (divides them) |
| **Super** | `Efficiency` | 470–477 | 8 | 0–255 | Meter gain rate from in-game events (squared multiplier, 0.44–2.25×) |
| | `Synergy` | 478–485 | 8 | 0–255 | Outbound meter bonus granted to teammates (squared multiplier, 0.44–2.25×) |
| | `Chemistry` | 486–493 | 8 | 0–255 | Inbound meter bonus received from teammates (squared multiplier, 0.44–2.25×) |

---

**Daze** (tuning in `DAZE`): when a check between opponents knocks the ubu that was hit by more than 250 px/s, it is dazed by (knock − 250) / 2850 ÷ its Stability, at most 20% per check (a neutral full-power check: 15%). The attacker, whichever drove into the contact faster, is not dazed by its own check; in an even head-on crash both are. Dazes stack up to 40%. Up to 15% a daze has no effect; beyond it the ubu's next launch speed is cut, rising evenly from 0 to 40% at the cap (30% daze: 24% slower); the daze clears when its next turn starts, whether it launches, guards or is stunned. Ubus dazed past 15% show a turning swirl above them and a "Dazed" note on their card with the launch cut.

## 3. Special Ability Loadout (Bits 494–509: 16 Bits)

Collision stability: ordinary body/ball contacts cannot increase total kinetic energy. Bounciness scales the rebound coefficient (capped at elastic restitution); Power, Strength and Stability redistribute the normal collision response within the incoming energy budget. Cannonball's single-use extra ball impulse is applied separately, so its intended boost remains available without ordinary ricochets repeatedly amplifying it. Shockwave does not impart velocity to an immovable Stalwart.

Spin strike: a launching ubu with spin arms a spin strike for the turn. If the ball is the first thing it touches, the ball gains the ubu's remaining angular velocity at contact times a gain, counter-rotating against the ubu in the same direction contact friction spins it (like meshing gears), capped at ±24 rad/s for the resulting ball spin, without adding translational velocity. Because spin decays, a long approach gives less. The gain is 1× from range and rises to 2× at point blank: at launch, measure the gap between the ubu's ball-contact hitbox (including Reach) and the ball's hitbox; the gain adds `p²(3−2p)` where `p = clamp(1 − gap / (4 × ball radius), 0, 1)`, so it starts rising within 2 ball diameters. The point-blank share of the gain also drives the ball harder: it adds speed along the ball's new heading of `0.5 × (gain − 1) × min(1, |spin| / max spin) × the ubu's speed at contact`, so a full-spin strike from touching range adds half the ubu's speed (initial tuning). Initial tuning, not an owner decision: base ubu maximum spin is 10 rad/s and every body loses 5 rad/s of spin each second. A wall bounce or touching another ubu first (teammate or opponent, even stationary) spends that ubu's strike; any other ubu touching the ball first cancels it. Simultaneous contacts grant no bonus. Only the opening approaching strike can apply it, never a rebound. Held, guarding and stunned ubus get none. Sticky contact consumes the opening strike without an extra spin bonus while attached; its settled position can supply a point-blank strike next turn. Preview, CPU search and gameplay share this implementation.

Four independent 4-bit slots encode an ubu's unlocked supers from the canonical 8 ability types (`slot_value % 8`):
- **Super Slot 1:** Bits 494–497 (0–15)
- **Super Slot 2:** Bits 498–501 (0–15)
- **Super Slot 3:** Bits 502–505 (0–15)
- **Super Slot 4:** Bits 506–509 (0–15)

Before each match, players equip one active super per ubu from their unlocked slots.

### The 8 Canonical Supers

| ID | Super | Archetype | Tactical Use | In-Game Mechanics |
| :--- | :--- | :--- | :--- | :--- |
| `0` | **Stalwart** | Anchor / Defense | Crease blocking, impenetrable screening | Body position locks at 0 velocity with infinite mass ($1/\text{mass} = 0$). Cannot be moved or deflected by any collision. Lasts 3 s of play. |
| `1` | **Knockout** | Enforcer / CC | Neutralizing key opposing threats | First opposing skater touched is stunned for the subsequent turn: frozen, and unable to guard. Armed for 3 s of play. |
| `2` | **Sticky** | Carrier / Possession | Puck recovery and controlled breakouts | On ball contact, the ball welds to the skater's body and travels with them. It lets go after 2 s of play, or when an opponent hits the carrier; the carrier skates with 1.5× friction meanwhile. Armed for 3 s. |
| `3` | **Cannonball** | Striker / Finisher | Long-range laser shots and blistering rebounds | Imparts $2\times$ base impulse to the ball on contact, and always counts as a big shot for hit-stop. Armed for 3 s of play. |
| `4` | **Magnet** | Playmaker / Interceptor | Puck retrieval and pass interception | Pulls the ball within 190 px for 3 s of play, up to 1000 px/s² close in, fading to nothing at the edge. |
| `5` | **Colossus** | Titan / Space Control | Wide zone coverage, heavy checking | Increases radius and mass by $1.8\times$ for 3 s of play (or until the turn settles); the extra weight slows its launch to about 55%. |
| `6` | **Shockwave** | Disrupter / Scrum Breaker | Clearing the crease and board pile-ups | Goes off on contact with an opponent, or when its 3 s run out: a radial blast repelling bodies and the ball within 170 px (teammates feel 40% of it). |
| `7` | **Ghost** | Infiltrator / Skater | Bypassing screens and heavy checks | Phases straight through opposing skaters without collision for 3 s of play, while still interacting with the ball and rink boards. |

Super timing (tuning in `SUPER`): every super lasts 3 s of play (720 ticks) or until spent, and ends when a turn settles; in Pulse it carries across the 1-second turns until its time runs out. Each super has a short, soft sound: Stalwart clanks like steel, Knockout lands a hard hit, Sticky squishes, Cannonball explodes, Magnet hums like a wobbling tractor beam while it pulls, Colossus crashes like thunder, Shockwave zaps, Ghost wobbles high and fast.

### Ball Responsibility & Goal Calls
- **Responsibility** (`credit` in `shared/ububall-match.js`): each ubu holds a share of responsibility for the ball's current velocity. After a tick in which ubus touch the ball, the part of the new velocity carried over from the old one (its projection, as a fraction) stays with whoever gave it, and the rest is split among that tick's touchers. A glancing deflection leaves a shot with its shooter; stopping or redirecting the ball takes it over. Boards do not change it. The responsible team is the one with the larger share. It resets at kickoff and carries across Pulse turns.
- **Goal calls**, shown in place of "GOAL" (first match wins): "OWN GOAL" when the conceding team was most responsible for the ball; "HAT TRICK!" for a scorer's third goal of the match (own goals do not count toward it); "BANK SHOT!" when the ball came off the boards after its last ubu touch; "SNIPE!" when the scorer's last touch was in their own half; "REBOUND!" within 1 second (240 ticks) of a save by the conceding team; "ACE!" on the first turn of a round.
- **Assists:** the teammate who passed to the scorer, with no opponent touch between that pass and the scoring shot (the scorer may touch it several times). It carries across turns, shows an "Assist" callout and earns $+4\% \times \text{Efficiency multiplier}$ (a proposed amount, not yet an owner decision). Own goals have no assist.
- **Callouts:** "Save!" or "Save..." over a saver (see Meter Accumulation), and "Spin strike!" when a close-range spin strike adds power.
- **Hit-stop** (tuning in `HIT_STOP` and `BIG_SHOT`), with a slight rink shake: 60 ms for a real save (not "Save..."), a spin strike or a big shot; 100 ms for a save of a big shot, a spin strike that is also a big shot, or a big shot that will travel at least a rink height (480 px) untouched (boards allowed); 150 ms for a big shot whose own path, ignoring ubus and stopping at the boards, goes into a goal. A big shot is a lone touch by an ubu driving into the ball at 80% or more of its own full-launch speed; the ball's speed does not count, so a fast ball off a still ubu is not one.
- **Match summary:** at full time, after the final goal's replay has played once, a summary shows the score, a comeback (the winner was 3 or more goals down) or shutout, and each ubu's goals, assists, saves and top shot (ball speed off its fastest touch), naming an MVP (3 per goal, 2 per assist or save, fastest shot breaks ties).

### Super Meter & Activation
- **Starting Meter:** Initialized at kickoff from `Ubuquity` (Bits 1014–1023: $\text{Ubuquity} / 1020 \times 100\%$).
- **Meter Capacity:** 100% per ubu. Activating a super costs 100% meter for that turn.
- **Meter Accumulation:**
  - Values in `METER` (`shared/ububall-match.js`); amounts are owner decisions of 2026-10-30. Every gain is scaled by `rate` (0.85, owner decision 2026-10-30), and the super stats use their multiplier squared (0.44–2.25×) so good ones matter and poor ones hold an ubu back. There is no passive per-turn gain.
  - Ball strikes: $+8\% \times \text{Efficiency multiplier}$.
  - Checks against an opponent: $+4\% \times \text{Efficiency multiplier}$ each. Teammate bumps earn nothing.
  - Conceding team rally bonus: $+6\% \times \text{Efficiency multiplier}$ upon being scored against.
  - Ace: a goal on the first turn of a round (the turns from one kickoff to the next goal) earns the scorer (the scoring team's last toucher) $+10\% \times \text{Efficiency multiplier}$, unless it is an own goal.
  - Save: $+6\% \times \text{Efficiency multiplier}$, with a "Save!" callout over the saver, when an ubu touches the ball while it is heading into its own goal and, from the field as it stood just before that contact and with the saver removed, the ball would have gone in touching nothing but the goal posts and net (no boards, no other ubu). Only a lone touch counts (two ubus meeting the ball in the same tick is a scramble), the ball must be within 300 px of the goal mouth's centre, and without the saver it must have been due in within 1 second (240 ticks); these limits are tuning in `SAVE`. The touch must also keep the ball out: from the field just after it, the ball must not go on into that goal (even off the boards) before another ubu touches it, so a deflection that still goes in is no save. A save from a ball the saver's own team was most responsible for (see Ball Responsibility) still shows, as "Save...", but earns nothing.
  - Anti-farming (tuning, not an owner decision): contact only counts at impact speed 60 or more, and each ubu earns contact meter at most once per 1.5 seconds of simulated play (ball and checks share the cooldown, which carries across Pulse turns).
  - Teammate Synergy/Chemistry: Whenever an ubu gains meter, teammates receive an inbound bonus: $\Delta M \times (\text{Synergy}^2 \times \text{Chemistry}^2 \times 0.15)$, using the stat multipliers.

---

## 4. AI Tactical Brain / Personality (Bits 510–533: 24 Bits)

Four 6-bit axes (`0–63`, neutral `31.5`) determining autonomous CPU behavior:

1. **`Aggression` (Bits 510–515, 6 bits):** Rink positioning (0 = Crease Anchor/Goalie, 63 = Hyper-Aggressive Forechecker).
2. **`Creativity` (Bits 516–521, 6 bits):** Shot selection (0 = Direct linear strikes, 63 = Bank shots off boards & heavy curve tricksters).
3. **`Teamwork` (Bits 522–527, 6 bits):** Playmaking (0 = Solo shooter, 63 = Dedicated passer).
4. **`Clutch` (Bits 528–533, 6 bits):** Composure surge when trailing or tied at match point (0 = Calm/steady, 63 = High-urgency hero surge).

---

## 5. Voice & Procedural Melody Suite (Bits 534–597: 64 Bits)

Enables full Web Audio synthesis of procedural voice and an 8-note personal goal fanfare jingle.

### Voice Synthesizer Profile (16 Bits)
- **`Instrument` (Bits 534–537, 4 bits: 0–15):** 16 synthesis sound profiles (Soft Bell, Woodblock, Metallic Ping, Crystal Chime, Square Chip, Sub-bass, etc.).
- **`Root Pitch` (Bits 538–543, 6 bits: 0–63):** 64 base chromatic pitches spanning 5+ octaves (C2 to D#7).
- **`Decay` (Bits 544–547, 4 bits: 0–15):** 16 envelope sustain lengths (40ms staccato to 1.2s resonant ringing).
- **`Timbre Mod` (Bits 548–549, 2 bits: 0–3):** Chorus/warmth modulation depth.

### 8-Note Goal Fanfare / Anthem (48 Bits)
- **`Scale / Mode` (Bits 550–552, 3 bits: 0–7):** 8 guaranteed-harmonious scales (Major, Minor, Pentatonic, Blues, Dorian, Japanese Insen, Synthwave, Retro Arcade).
- **`Tempo` (Bits 553–555, 3 bits: 0–7):** 8 speed settings (60 to 160 BPM).
- **`8 Notes` (Bits 556–595, 40 bits — 8 notes @ 5 bits each):**
  - *Per Note:* 3 bits Scale Degree (1 to 8: Root, 2nd, 3rd, 4th, 5th, 6th, 7th, Octave) + 2 bits Duration/Articulation (Eighth, Quarter, Staccato tap, Rest).
- **`Swing / Groove` (Bits 596–597, 2 bits: 0–3):** Straight, Swing, Triplet, Syncopated.

---

## 6. Unassigned Reserve & Ubuquity (Bits 598–1023)

- **Unassigned Reserve (Bits 598–1013, 416 bits):** Exactly 52 bytes of pristine unassigned space reserved for future game modes, sports, tournament perks, or visual auras.
- **Ubuquity (Bits 1014–1023, 10 bits):** Starting special meter % (`0–1023`, where values 1021–1023 = 100% full meter).
