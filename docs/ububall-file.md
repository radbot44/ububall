# Match replays and the .ububall file

Status: working development profile implemented in `shared/ububall-replay.js` (owner requests 2026-10-31: replays of past matches and of single turns in regular and Pulse play, stored locally, renamed and exported as `.ububall`; refuse files from another physics version). The format is not frozen.

## How a replay plays

A replay stores each turn's starting field and all six moves, and plays a turn by re-simulating it with `P.startTurn` and `P.step`, as goal replays do. Everything between turns (goals, kickoffs, fouls, meter) is in the next turn's snapshot, so only the in-turn physics has to match. Seeking loads the nearest turn's start and simulates forward without effects.

Re-simulation is exact within one JavaScript engine. JSON keeps every number except the sign of zero, which no position depends on (the replay test checks this). Engines may differ in the last bit of `Math` functions, so a replay watched in another browser can drift within a turn; the next turn's snapshot corrects it.

## Physics version

`VERSION` in `web/ububall-physics.js` names how turns play out. Any change to `startTurn`, `step` or their tuning must bump it. Readers refuse a file with another physics version ("from an older/newer version of ububall"), and the replay library deletes stored replays from another version when it opens. `test/ububall-replay.test.js` pins a fingerprint of a simulated match per version and fails, naming the new fingerprint, when the physics changes.

## Encoding

- Extension `.ububall`. Content: gzip (RFC 1952) of UTF-8 JSON with the exact field order below, no whitespace. At most 8 MiB compressed and 64 MiB of JSON, 5000 turns.
- Readers decompress, decode UTF-8 with fatal errors, parse, validate every field and type, then require `JSON.stringify` of the validated replay to equal the text. This rejects duplicate, extra or reordered fields and other number spellings.
- Field order: `type` (`"ububall-replay"`), `format` (2), `physics` (the physics version), `mode` (a match mode, e.g. `"pulse-blitz"`), `seat` (0 or 1: the team shown on the left), `title` (the name given to it, 1–80 characters without surrounding spaces, or null), `clip` (true for a clip), `names` (two team labels, at most 64 characters, in rink order), `ubus`, `recorded` (milliseconds since 1970), `final`, `turns`.
- `ubus`: six `{"dna","super"}` in rink order (team 0 slots 0–2, then team 1). `dna` is the 171-character canonical base64url DNA (docs/dna.md); `super` the equipped super id (0–7), or null in Classic. Only DNA is kept: a replay carries no certificate and proves no ownership.
- `final`: `{"scores":[a,b],"winner":0|1}` for a finished match, or null for one left early and for every clip.
- Each turn: `turn` (the match's turn number), `scores` (as the turn began), `fouls` (`{"crease":[bool,bool],"corner":null|0–3,"cornerTurns":n}` as the turn began), `bodies`, `plans`, `ticks` (1–2880 ticks of 1/240 s played), `goal` (null or `{"team","label","scorer","assist"}`, ubu indexes or null; an own goal has no scorer), `cards` (indexes carded at the turn's end).
- `bodies`: the seven bodies (six ubus in rink order, then the ball) before `P.startTurn`, each with only the fields the simulation uses, in the order of `BODY` in `shared/ububall-replay.js`. References are indexes (`stuckTo`), the equipped super its id; presentation fields (names, voices) are left out.
- `plans`: six `{"angle","power","spin","superArm","guard"}` as the turn started with them. Angles are kept as given, not normalised, because normalising changes the launch.

## Clips

A clip is a replay of consecutive turns of another, starting from its first turn's snapshot: one turn, or the play around a turn (`playRange`): the unbroken motion from the field last at rest or a kickoff to a goal or the field resting again. Every turn outside Pulse starts at rest, so there a play is one turn; in Pulse it usually spans several one-second turns. The viewer saves either to the library, named after its turns and teams.

## Storage

Local and online matches are recorded turn by turn (online, from the server's per-turn replay in its seat-0 order) and saved when they end, when a new match replaces them, when an online match is left, or when the page closes; an unfinished match keeps its whole turns. Saved replays live in the browser's IndexedDB (`ububall` database, `replays` store) as the `.ububall` bytes with a summary for the list. The latest 25 automatically saved matches that are not pinned are kept (`KEEP`); the oldest go first. Pinned replays, clips and imported files stay until deleted. Renaming rewrites the stored file, so an export carries the name. A deleted replay can be restored with Undo while the library stays open. Imports are read exactly like any other file.
