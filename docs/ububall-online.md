# Online Ububall implementation

Owner decisions: private invite matches; host chooses owned-ubu or practice teams; 60-second disconnect grace before the connected opponent may claim forfeit. Disconnects pause planning and preserve the remaining Blitz time. Blitz expiry uses the latest server-saved draft, even if not locked. Opponent drafts remain private until resolution.

The online match shares the local game's meter and Blitz rules. Its server-side lifecycle handles move validation, private drafts, locking, deadline expiry, pause/resume and forfeit authorization.

Authoritative turn resolution validates both teams' moves and super eligibility, runs the existing 240 Hz physics for at most 12 seconds (1 second in Pulse, whose replays chain turn to turn from each turn's moving initial state), and returns the resulting state plus replay frames sampled every eight ticks. Scoring, end-of-turn meter and stun rules are shared with the local game. Tests cover deterministic resolution, input immutability, bounded replay, victory and super meter consumption.

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

## Queues and live spectating

Launching in Discord signs the player in to the lobby for that Activity, initially **Not ready**. The panel beside the rink shows four player cards per row: Discord avatar (initials when unavailable), name and **Ready**, **Not ready**, **Balling** or **Spectating**. Presence expires after 20 seconds without a heartbeat. **Ready to play** immediately matches another ready player in that lobby with practice teams; **Cancel ready** stops waiting. **Play vs CPU**, **Find Online Match**, and **Watch** cancel lobby readiness and pending challenges. Public matchmaking retains its separate practice-team queue for Activity and standalone players.

Players may challenge Ready or Not ready members of their own lobby. A challenge can be accepted, declined or canceled and expires after 30 seconds or when a participant leaves or becomes busy. Acceptance reserves both seats together, preventing a competing queue or challenge from assigning either player again. Accepted challenges open the shared rules popup followed by team selection, with a per-player choice of practice team or owned ubus. Either player may change the rules during setup; changing them clears both players' readiness. Owned-team selection still requires server verification of the collection and supers.

Instant lobby matches show a prominent **Change rules** button until the first player locks their launch. Applying different rules creates a fresh game with those rules and the same players and practice teams, keeping their connections. The server serializes rule changes against launches, rejects outdated rules editors and rejects moves or teams from a previous game generation. Direct challenges retain the rules/team setup flow rather than starting automatically.

Both players can opt in to spectating from the team lobby or the match menu. Once both opt in, they can copy a separate watch link. Members of the Activity can also find its enabled friend matches under **Watch**. The viewer receives the public rink, scores and resolved turns. Draft moves, team selection and match controls stay with the players. Either player can revoke the link and end existing viewer connections.

## Discord test setup

1. Use a private Discord Developer Portal application and an isolated HTTPS origin that reaches the test Worker. Set `ORIGIN` to that exact origin and map the Activity's root URL to it. Enable Activities and the target platforms, then add the test accounts.
2. Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` for that application. Set its bot token as `DISCORD_ACTIVITY_BOT_TOKEN` in ignored local configuration or the Worker secrets. The backend uses the token for Activity membership checks. The existing standalone OAuth flow still uses its configured `/auth/callback`.
3. Launch through Discord and test with two players and a viewer. Confirm the embedded sign-in cookie and proxied WebSocket upgrade, test a mid-match join and revocation, and try backgrounding and resuming on mobile. Then queue one player inside Discord and one in standalone ububall.

Activity launch through Discord's live proxy and deployment require separate verification. See [Discord's setup guide](https://docs.discord.com/developers/activities/building-an-activity) and [networking guide](https://docs.discord.com/developers/activities/development-guides/networking).

Local verification (2026-11-05): `npm test` and `npm run test:worker` pass. Unit and isolated Worker tests cover lobby isolation, challenge expiry/authorization, concurrent acceptance, queue reservations, spectator revocation, presence expiry and rule-change/launch races. Isolated Chromium and Firefox browser exercises cover four-column desktop/phone layouts, challenge rules/team setup, instant kickoff and a rule reset visible to both players, with no browser script errors. These fixtures do not establish live Discord proxy behavior or owner acceptance.
