# Ububall Design & 1024-Bit DNA Specification

Ububall is a 3v3 simultaneous-turn physics hockey game played on a curved-corner rink.

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

Every stat is stored as an 8-bit unsigned integer (`0–255`, neutral `127`) and evaluated through the centered cubic multiplier curve ($0 = 2/3\times$, $127 = 1.0\times$, $255 = 1.5\times$).

| Category | Stat | Bits | Width | Values | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Movement** | `Impulse` | 374–381 | 8 | 0–255 | Engine thrust / launch speed ceiling |
| | `Traction` | 382–389 | 8 | 0–255 | Braking deceleration on ice |
| | `Spin` | 390–397 | 8 | 0–255 | Maximum launch rotation rate |
| | `Curve` | 398–405 | 8 | 0–255 | Magnus effect trajectory bending |
| **Physical** | `Size` | 406–413 | 8 | 0–255 | Physical collision radius |
| | `Mass` | 414–421 | 8 | 0–255 | Body weight and collision momentum |
| | `Bounciness` | 422–429 | 8 | 0–255 | Collision elasticity / restitution |
| | `Grip` | 430–437 | 8 | 0–255 | Contact friction and spin transfer |
| **Engagement** | `Power` | 438–445 | 8 | 0–255 | Velocity transfer to the ball (shot power) |
| | `Reach` | 446–453 | 8 | 0–255 | Ball-only intercept/poke-check radius |
| | `Strength` | 454–461 | 8 | 0–255 | Check momentum delivered into opponents |
| | `Stability` | 462–469 | 8 | 0–255 | Resistance to checks and momentum loss |
| **Super** | `Efficiency` | 470–477 | 8 | 0–255 | Meter gain rate from in-game events |
| | `Synergy` | 478–485 | 8 | 0–255 | Outbound meter bonus granted to teammates |
| | `Chemistry` | 486–493 | 8 | 0–255 | Inbound meter bonus received from teammates |

---

## 3. Special Ability Loadout (Bits 494–509: 16 Bits)

Collision stability: ordinary body/ball contacts cannot increase total kinetic energy. Bounciness scales the rebound coefficient (capped at elastic restitution); Power, Strength and Stability redistribute the normal collision response within the incoming energy budget. Cannonball's single-use extra ball impulse is applied separately, so its intended boost remains available without ordinary ricochets repeatedly amplifying it. Shockwave does not impart velocity to an immovable Stalwart.

Close-control spin: a launching ubu can add selected spin to the opening ball strike. At launch, measure the gap between its ball-contact hitbox (including Reach) and the ball's hitbox. The bonus smoothly increases from zero at 1.5 ball diameters to full at touching, using `p²(3−2p)` where `p = clamp(1 − gap / (3 × ball radius), 0, 1)`. The initial tuning adds up to twice the selected launch angular velocity, capped at ±24 rad/s for the resulting ball spin, without adding translational velocity. Zero-spin, held and stunned ubus receive no bonus. Leaving range permanently cancels eligibility for that turn; any other ubu touching first also cancels it, including a teammate or stationary contact. Simultaneous contacts grant no bonus. Only the opening approaching strike can apply it, never a rebound. Sticky contact consumes the opening strike without an extra spin bonus while attached; its settled position can supply a full-bonus setup next turn. Preview, CPU search and gameplay share this implementation.

Four independent 4-bit slots encode an ubu's unlocked supers from the canonical 8 ability types (`slot_value % 8`):
- **Super Slot 1:** Bits 494–497 (0–15)
- **Super Slot 2:** Bits 498–501 (0–15)
- **Super Slot 3:** Bits 502–505 (0–15)
- **Super Slot 4:** Bits 506–509 (0–15)

Before each match, players equip one active super per ubu from their unlocked slots.

### The 8 Canonical Supers

| ID | Super | Archetype | Tactical Use | In-Game Mechanics |
| :--- | :--- | :--- | :--- | :--- |
| `0` | **Stalwart** | Anchor / Defense | Crease blocking, impenetrable screening | Body position locks at 0 velocity with infinite mass ($1/\text{mass} = 0$). Cannot be moved or deflected by any collision. |
| `1` | **Knockout** | Enforcer / CC | Neutralizing key opposing threats | First opposing skater touched is stunned for the subsequent turn (launch velocity forced to 0). |
| `2` | **Sticky** | Carrier / Possession | Puck recovery and controlled breakouts | On ball contact, the ball welds to the skater's body and travels with them until the turn settles. |
| `3` | **Cannonball** | Striker / Finisher | Long-range laser shots and blistering rebounds | Imparts $2.5\times$ base impulse to the ball on contact. |
| `4` | **Magnet** | Playmaker / Interceptor | Puck retrieval and pass interception | Exerts a continuous attractive tractor pull on the ball within 260px while the skater is in motion. |
| `5` | **Colossus** | Titan / Space Control | Wide zone coverage, heavy checking | Temporarily increases radius by $1.8\times$ and mass by $2.5\times$ for the turn, resetting on turn settle. |
| `6` | **Shockwave** | Disrupter / Scrum Breaker | Clearing the crease and board pile-ups | Triggers a radial concussive blast repelling all bodies within 220px outward upon impact. |
| `7` | **Ghost** | Infiltrator / Skater | Bypassing screens and heavy checks | Phases straight through opposing skaters without collision, while still interacting with the ball and rink boards. |

### Super Meter & Activation
- **Starting Meter:** Initialized at kickoff from `Ubuquity` (Bits 1014–1023: $\text{Ubuquity} / 1020 \times 100\%$).
- **Meter Capacity:** 100% per ubu. Activating a super costs 100% meter for that turn.
- **Meter Accumulation:**
  - Ball strikes: $+18\% \times \text{Efficiency multiplier}$.
  - Body checks: $+10\% \times \text{Efficiency multiplier}$.
  - Passive turn completion: $+10\% \times \text{Efficiency multiplier}$.
  - Conceding team rally bonus: $+15\%$ upon being scored against.
  - Teammate Synergy/Chemistry: Whenever an ubu gains meter, teammates receive an inbound bonus: $\Delta M \times (\text{Synergy} \times \text{Chemistry} \times 0.25)$.

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
