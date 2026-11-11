# Screenshot-only playing agent

This experiment drives the **real local Ububall website**, not a separate match simulator. Its normal playing mode is controlled exclusively by a vision model's reading of browser screenshots and by raw Playwright mouse events. There is no use of `ububallPhysics`, `ububallMatch`, `ububallCPU`, `page.evaluate`, DOM queries, canvas parsing, saved match state, private CPU planning, or WebSocket game state inside the playing loop.

## What the playing agent can see and do

- Receives the visible **1440×930** browser image; after a launch it also receives screenshots from early and middle motion.
- Can issue a bounded set of pixel-coordinate **click**, **drag**, **scroll**, and **wait** commands. Drags perform mouse-down, smooth movement, and mouse-up on the live browser.
- Describes visual observations, tactical reasoning, predictions and lessons for the next decision, without access to game-state telemetry.
- Learns only from screenshots and its own previous short lessons (most recent five).
- Can advance kickoff, operate visible spin/guard/super controls, and detect the final scoreboard from the screen.
- Cannot perform arbitrary URLs, external navigation, JavaScript evaluation, DOM inspection or source reads. A request interceptor blocks non-local network access from the game page.
- The game remains the unmodified Standard-mode local CPU match. The initial Quick Play UI defaults to Easy CPU.

The vision controller is `scripts/vision-only-play.cjs`. It temporarily runs `npm run dev` in a GitHub Actions checkout, serves the real site at 127.0.0.1:8790, and saves its transcript and images under `artifacts/vision-only/` as a workflow artifact. No production deployment or minting occurs.

## Run it

Use GitHub Actions → **Vision-only Ububall match** → **Run workflow**. Choose:

- `smoke` to verify local browser boot and Quick Play navigation, without an API key or image-model calls. The smoke test is not a vision game.
- `vision` for a complete screenshot-only agent. This requires an **Actions repository secret** named `OPENAI_API_KEY` and incurs separately billed OpenAI API usage. Never commit a key or log its value.
- Optionally set the model to a vision-capable Responses API model (default `gpt-4.1`) and `max_steps` (default 90, hard maximum 160).

The CLI equivalent after installing dev dependencies and Playwright Chromium is:

```sh
node scripts/vision-only-play.cjs --smoke
OPENAI_API_KEY=... VISION_MODEL=gpt-4.1 node scripts/vision-only-play.cjs
```

Set the API key using a secret store or exported environment variable, not a checked-in file. ChatGPT subscriptions and API billing are distinct.

## Evidence

Every model call writes a numbered screenshot and the JSON decision. Each launch captures early/mid-motion images and a later settled-screen snapshot. The transcript includes what the agent believed it saw, predicted, attempted, and learned; the final result is tagged **visually inferred**. The harness does not silently reclassify unfinished matches as wins. An API error, timeout or maximum-step stop leaves partial evidence.

Do **not** use the smoke-mode DOM selector as evidence that the vision agent relied on DOM: it is isolated to the smoke test before the vision loop. For a benchmark comparison, use the pre-existing engine-level and state-based browser harnesses from the prior playtest.

## Limitations to investigate

- A model may misunderstand the direction or strength of a drag, or mistake an animation frame for the settled outcome.
- Vision reasoning is slower and more expensive than the built-in CPU. The fixed 14.5-second post-launch observation is intentionally conservative for the game's 12-second physics cap and presentation time.
- A later experiment could evaluate actual state or a replay **after play finishes**, but this first version intentionally does not extract any internal game data.
- There is currently no authenticated API key available to the ChatGPT execution sandbox, so real model-driven completion requires the repository secret or another explicitly connected vision inference endpoint. A green smoke test alone never proves the vision player won.
