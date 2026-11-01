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
- Field order: `type` (`"ububall-replay"`), `format` (3), `physics` (the physics version), `mode` (a match mode, e.g. `"pulse-blitz"`), `seat` (0 or 1: the team shown on the left), `title` (the name given to it, 1–80 characters without surrounding spaces, or null), `clip` (true for a clip), `anonymous` (true when exported with names hidden), `names` (two team labels, at most 64 characters, in rink order), `ubus`, `recorded` (milliseconds since 1970), `final`, `turns`.
- `ubus`: six `{"dna","super"}` in rink order (team 0 slots 0–2, then team 1). `dna` is the 171-character canonical base64url DNA (docs/dna.md); `super` the equipped super id (0–7), or null in Classic. Only DNA is kept: a replay carries no certificate and proves no ownership.
- `final`: `{"scores":[a,b],"winner":0|1}` for a finished match, or null for one left early and for every clip.
- Each turn: `turn` (the match's turn number), `scores` (as the turn began), `fouls` (`{"crease":[bool,bool],"corner":null|0–3,"cornerTurns":n}` as the turn began), `bodies`, `plans`, `ticks` (1–2880 ticks of 1/240 s played), `goal` (null or `{"team","label","scorer","assist"}`, ubu indexes or null; an own goal has no scorer), `cards` (indexes carded at the turn's end).
- `bodies`: the seven bodies (six ubus in rink order, then the ball) before `P.startTurn`, each with only the fields the simulation uses, in the order of `BODY` in `shared/ububall-replay.js`. References are indexes (`stuckTo`), the equipped super its id; presentation fields (names, voices) are left out.
- `plans`: six `{"angle","power","spin","superArm","guard"}` as the turn started with them. Angles are kept as given, not normalised, because normalising changes the launch.

## Viewer

Beside playback and the timeline, the viewer offers (owner requests 2026-10-31):
- **Moves** and **Trails**, remembered on the device: Moves draws each ubu's launch from where the turn started (faded when it guarded), with its guard shield and armed super; Trails draws the path each body has taken so far this turn. Both show in videos and share cards.
- **Stats**, worked out by playing the replay through once without effects: each ubu's goals, assists, saves, ball touches (a touch counts once until another ubu touches the ball or half a second passes), top shot and distance skated, each team's share of the time it last touched the ball, and a map of where each ubu touched the ball, a star marking each scoring touch.
- **Play from here**: a match against the CPU from the start of the turn on screen, playing the left team, with the score, fouls and round so far; meter cooldowns start afresh. It is recorded as a new match.
- **Share**: the moment on screen as a 1080×960 PNG card: the scorebug, the field cropped as videos are with any moves or trails, an ububall.com watermark and a line inviting others to play. It shows at once in the dialog and is encoded only when shared (the device's share sheet, where it can share files) or saved. Hide names redraws it.

Videos and share cards carry the ububall.com logo (`web/assets/ububall-logo-com.svg`).

## Clips

A clip is a replay of consecutive turns of another, starting from its first turn's snapshot: one turn, or the round around a turn (`roundRange`): every turn from the kickoff before it (the replay's start, or the turn after a goal) through the turn that scored, in any mode. The viewer exports the whole replay, the round or the turn (Export replay or Export video, then match, round or turn); a part is written as a clip named after its round or turns and teams. Clips are not saved to the library; imported ones are listed there.

## Hidden names

Exporting with Hide names writes an anonymous replay (`anonymize`, owner request 2026-10-31): the teams become Saffron (the side shown on the left) and Amethyst, and each ubu's 64-bit name seed (the first 8 DNA bytes, docs/dna.md) is zeroed, so its name is gone while its looks, voice and stats stay; any custom title is dropped. Play is unchanged, since turns carry their own fields. Readers require the zeroed seeds when `anonymous` is true, and the viewer calls the ubus Saffron 1–3 and Amethyst 1–3. A video exported with names hidden shows the same names. The rest of the DNA is kept, so a party holding a registry of minted DNA could still match the ubus; hidden names keep them from viewers, not from the mint.

## Storage

Local and online matches are recorded turn by turn (online, from the server's per-turn replay in its seat-0 order) and saved when they end, when a new match replaces them, when an online match is left, or when the page closes; an unfinished match keeps its whole turns. Saved replays live in the browser's IndexedDB (`ububall` database, `replays` store) as the `.ububall` bytes with a summary for the list. The latest 25 automatically saved matches that are not pinned are kept (`KEEP`); the oldest go first. Pinned replays, clips and imported files stay until deleted. Renaming rewrites the stored file, so an export carries the name. A deleted replay can be restored with Undo while the library stays open. Imports are read exactly like any other file.

## Video export

The viewer exports a replay, play or turn as an MP4 (owner decision 2026-10-31: MP4 over WebM, for playback on phones and in sharing apps): 1920×1080 at 60 fps, H.264 at a constant 1.5 Mb/s (about 11 MB a minute; the encoders' variable mode overshot low targets several times over, so constant is asked for first), with AAC sound, or Opus where the browser cannot encode AAC, or no sound where it can encode neither. It renders faster than real time: the replay advances on the export's own clock frame by frame, each frame is drawn (the field filling the width, cropped to the boards, goals and Pulse strip, its ubus and their badges, under a slim scorebug band) and encoded with WebCodecs, and the game's sounds are scheduled into an offline audio context at each frame's time. That context renders alongside the video, pausing a second behind it, and sends every sound through one shared compressor instead of one per sound (the per-sound chains made the render several times slower; the mix differs by well under a decibel). The background and scorebug are drawn once per score or turn, and the page's own field and controls are left alone until the export ends. Turns play at full speed, each goal holds 2.5 s, the match's winning goal is followed by the winner's call (with a comeback or shutout), and the final field holds 1 s, as in the viewer. `web/mp4.js` writes the file with the movie box first; it holds the encoded samples in memory until the end. Browsers without `VideoEncoder` hide the button.

