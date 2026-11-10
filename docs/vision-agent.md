# Vision-only agent playtest

This is a **separate experimental harness**, not a replacement for the original state-based CPU test. It plays the unmodified local browser game through ordinary mouse inputs and uses only screenshots as observations. No DOM queries, `page.evaluate`, game objects, CPU plan hooks, simulated trajectories, or privileged state are passed to the playing model.

## Running

From the repository root (Node 22.13+):

```bash
npm ci
npm install --no-save --ignore-scripts playwright@1.57.0
npx playwright install chromium
OPENAI_API_KEY=... node scripts/agent-vision-play.cjs
```

Or run the **Vision-only Ububall playtest** GitHub Actions workflow, after adding an `OPENAI_API_KEY` repository secret under **Settings → Secrets and variables → Actions → New repository secret**. Never commit an API key or print it in CI logs. The API key is billed separately from a ChatGPT subscription. The workflow runs the full vision model only when the secret is present; otherwise it performs a real browser startup/screenshot smoke test, **not a game**.

The script defaults to `gpt-5.4-mini` and accepts `VISION_MODEL`, `VISION_MAX_STEPS`, `VISION_MAX_CALLS`, `VISION_MAX_MINUTES` and `VISION_OUTPUT`. Set a reasonable API usage limit on the API project as well; these local caps limit requests, not exact dollar cost. Run `node scripts/agent-vision-play.cjs --smoke` without a key to verify that the browser, local Worker, screenshots, and video recording work.

## Experiment protocol

- A fresh 1440×930 browser context visits the homepage. The vision model sees that screenshot and must click Quick play. The default fresh-profile quick play is Standard versus Easy CPU.
- On each decision it receives up to four **unaltered screenshots** and a short textual record of **its own** earlier actions, predictions, and lessons. Browser screen coordinates and viewport size are the only numerical game-specific input. It outputs up to four click/drag/wait/launch actions.
- A drag is physically executed with Playwright mouse events. A launch is a click at the visually chosen location, followed by four sampled screenshots (early motion, contact, late motion, and after settling). Only the screenshots, never hidden game state, feed the next decision.
- `visible_phase`, `visible_score`, strategy, prediction, and lesson are **model claims**, not ground truth. The agent is asked to declare completion only when the screenshot visibly reads Final; review the saved screenshot before counting a win.
- For auditability, the artifact contains `frames/*.jpg`, `events.json`, `summary.json`, `final-observation.jpg`, and Chromium video. It also captures page errors for debugging, but these errors are **never** supplied as the playing model's observations.
- Automated runs stop on a model-reported final, a call/step/time budget, or error. An incomplete run is not a victory. The agent does not run on the production site or use a signed-in account.

## Controls and limits

This is intentionally not deterministic: vision interpretation, environment rendering and model choices vary. The agent may misuse the controls or fail to finish. There is no guarantee of winning or reliable visual score reading. We should first inspect one completed full run before comparing results with the telemetry-driven baseline. A stronger later experiment would collect blinded evaluations over several random rosters and a separate independent screenshot-only goal verifier.

**Security:** The model calls the OpenAI API with actual screenshots. They may contain visible game text/graphics; no account login is used. `store:false` is set on requests. GitHub artifacts contain screenshots/video and expire after seven days. The action runs with read-only GitHub repository permissions. 