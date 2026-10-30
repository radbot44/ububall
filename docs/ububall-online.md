# Online Ububall implementation

Owner decisions: private invite matches; host chooses owned-ubu or practice teams; 60-second disconnect grace before the connected opponent may claim forfeit. Disconnects pause planning and preserve the remaining Blitz time. Blitz expiry uses the latest server-saved draft, even if not locked. Opponent drafts remain private until resolution.

Implemented foundation: shared meter rules and Blitz duration calculation used by the local game; strict network move validation; a server-side match lifecycle with private drafts, locking, deadline expiry, pause/resume and forfeit authorization. These modules are not exposed through network routes yet.

Authoritative turn resolution validates both teams' moves and super eligibility, runs the existing 240 Hz physics for at most 12 seconds, and returns settled state plus replay frames sampled every eight ticks. Scoring, end-of-turn meter and stun rules are shared with the local game. Tests cover deterministic resolution, input immutability, bounded replay, victory and super meter consumption.

Completed online play architecture:
- Dedicated `UbuballMatch` Durable Object per match, persisting state to SQLite and driven by alarms for turn resolution and timeouts.
- Authenticated HTTP and WebSocket routes enforce Discord session identity and exact Origin; player drafts remain strictly private until turn resolution.
- Trusted roster verification queries `MintRegistry` for owned ubus and validates equipped supers; practice teams generate server-side DNA.
- Symmetrical rightward-attacking client view transform flips seat 1 coordinates and angles seamlessly.
- Replay playback interpolates 30 Hz sampled frames, delays scoreboard updates until the goal moment, triggers fanfare, bursts, and super audio, and highlights scoring players.
- Strict control locking across moves locking, turn motion, opponent disconnects, and match completion; disconnects freeze Blitz planning and allow forfeit claims after 60 seconds.
- Heartbeats use the Durable Object WebSocket auto-response, so `{"type":"ping"}` never wakes a hibernating match; liveness uses the auto-response timestamp.
- Guests may host and join without Discord. Guest seats always field server-generated practice teams and cannot reach the mint; a guest who signs in with Discord in the same browser keeps their seat.
- Reconnects and page reloads seamlessly restore active matches via `?match=<id>` URL parameters.
- Comprehensive test coverage in `test/ububall-match.test.js` and `test/worker.integration.mjs`.

Remaining: Deployment is separate authorization. Existing local matches continue to work.
