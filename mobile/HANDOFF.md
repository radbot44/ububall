# Ububall Standalone Android — Antigravity Porting & Build Handoff

This package prepares Ububall for a standalone **Capacitor Android** build while preserving 100% parity with the live Web app and Discord Activity, and isolating all Android/Gradle dependencies inside `mobile/` so Cloudflare Worker deployments (`.\install.ps1` / `.\deploy.ps1`) stay untouched.

## 1. Porting Manifest (into `C:\dev\ububall`)

Because the cloud prep archive was built from a gitless source snapshot, copy or reconcile **only** the touched files below into your git-tracked `C:\dev\ububall` checkout (do not overwrite `.git/` or any newer uncommitted local work):

### New Files (Copy Directly)
- `web/platform.js` — Zero-dependency Capacitor runtime bridge (`isNative` detection, `https://ububall.tch.one` API/WSS origin routing, `Bearer` token storage, RFC 7636 PKCE Custom Tabs Discord login + deep-link completion, chunked `Filesystem` + `Share` exports for `.ubu`/`.ububall`/`.mp4`/PNG cards, incoming `content://` `.ubu`/`.ububall` file imports, Android hardware `backButton` stack, `ScreenOrientation` lock, `SystemBars` immersive mode, background `AudioContext` pause/resume, and throttled `Haptics` hooks on `ubuAudio`).
- `test/platform.test.js` — Node unit tests covering web passthrough, native Capacitor bridge behavior, PKCE login/deep-link exchange, file exports, haptics throttling, back-button priority, and repo config alignment.
- `mobile/package.json` — Isolated Capacitor 8 + official plugin dependencies and `sync` / `run:android` / `build:debug` / `build:release` scripts.
- `mobile/capacitor.config.json` — Configured with `"appId": "one.tch.ububall"`, `"webDir": "../dist/public"`, dark `#101112` background/splash, and `https://localhost` WebView origin.
- `mobile/android-manifest-snippets.xml` — Ready-to-paste `MainActivity` `<intent-filter>` blocks for `ububall://` OAuth/deep links, verified `https://ububall.tch.one` Android App Links, and `.ubu` / `.ububall` file associations.
- `mobile/assetlinks.example.json` — Reference structure for `/.well-known/assetlinks.json`.
- `mobile/HANDOFF.md` — This runbook.

### Modified Files (Review Diff / Apply)
- `.gitignore` — Excludes `*.jks`, `*.keystore`, `mobile/node_modules/`, and Gradle build directories.
- `install.ps1` — Filters `Where-Object { $_ -notlike 'mobile/*' }` so `ubumint-cloudflare` never receives Android/Gradle files.
- `package.json` — Appends `test/platform.test.js` to `npm test`.
- `wrangler.jsonc` — Adds `"/.well-known/assetlinks.json"` to `run_worker_first`.
- `scripts/prepare-assets.cjs` — Adds `'platform.js'` to `webFiles`.
- `server/auth.mjs` — Adds `MOBILE_ORIGIN = 'https://localhost'`, `purpose: 'mobile'` Bearer session tokens, PKCE `/auth/discord?platform=android&challenge=...`, 60-second `mobile-handoff` callback fragment redirect, `mobileExchange` (preserving guest match seat `alias`), mobile guest token creation, and 30-second match-bound `issueSocketTicket` / `verifySocketTicket`.
- `server/worker.mjs` — Adds `OPTIONS /api/*` CORS preflight for `https://localhost`, `withCors()` wrapper on Durable Object HTTP JSON responses, `POST /api/auth/mobile`, `POST /api/ububall/:id/socket-ticket`, `?ticket=` socket auth fallback, mobile guest token responses, and dynamic `GET /.well-known/assetlinks.json` (driven by optional `ANDROID_PACKAGE_NAME` + `ANDROID_SHA256_FINGERPRINTS` vars).
- `web/index.html` — Loads `<script src="platform.js" defer></script>` before `ububall-activity.js`.
- `web/auth-complete.html` — Redirects `?mobile=1#ticket=...` to `ububall://auth#ticket=...` with a tap-to-return fallback button in Chrome Custom Tabs.
- `web/site-header.js` — Routes session/logout/refresh calls through `ubuPlatform.fetch`, delegates native Discord login to `ubuPlatform.openDiscordLogin`, and syncs mobile Bearer tokens.
- `web/starter.js`, `web/ubu-list.js`, `web/site.js` — Routes `/api/*` through `ubuPlatform.fetch`; wires `.ubu` download/import to native Share/Filesystem.
- `web/ububall-online.js` — Routes `/api/*` through `ubuPlatform.fetch`, builds invite/watch links from `ubuPlatform.publicOrigin()`, enables native invite sharing, stores mobile guest tokens, and acquires a 30s `socket-ticket` before opening native `wss://` match sockets.
- `web/ububall-stats.js`, `web/ububall-theater.js`, `web/ububall-playback.js` — Wires `.ububall`, `.mp4`, and PNG card exports to `ubuPlatform.exportFile`, handles incoming `.ububall` file intents, and binds `#btn-rotate` / fullscreen to `ScreenOrientation` and `SystemBars`.
- `test/auth.test.mjs`, `test/worker.integration.mjs` — Adds unit and Worker integration tests for mobile PKCE OAuth, Bearer sessions, CORS preflight, guest upgrade, and socket tickets.

## 2. Local Verification & Native Build Steps (Antigravity Agent)

1. **Verify full Node 22+ & Worker suites in `C:\dev\ububall`:**
   ```powershell
   npm test
   npm run test:worker
   ```
   *(Note: `test/mint.test.js`, `test/ububall-bench.test.js`, and `test/worker.integration.mjs` require your local Node 22+ and `node_modules` with `esbuild` + `wrangler`, which could not run in the offline Node 18 cloud container.)*

2. **Initialize the Capacitor Android project inside `mobile/`:**
   ```powershell
   cd C:\dev\ububall\mobile
   npm install
   npx cap add android
   npm run sync
   ```
   *(Check `web/platform.js` line 4 `DEFAULT_API_ORIGIN = 'https://ububall.tch.one'` — adjust if your production domain differs. For local Worker testing over USB `adb reverse tcp:8790 tcp:8790`, run `localStorage.setItem('ububall:api-origin', 'http://127.0.0.1:8790')` in WebView DevTools.)*

3. **Apply Android Manifest & SDK settings (`mobile/android/`):**
   - In `mobile/android/variables.gradle`, verify `targetSdkVersion = 36` (`compileSdkVersion = 36`, `minSdkVersion = 26`).
   - In `mobile/android/app/src/main/AndroidManifest.xml`, set `android:launchMode="singleTask"` on `.MainActivity` and paste the three `<intent-filter>` blocks from `mobile/android-manifest-snippets.xml`.
   - Generate launcher & splash assets from `web/assets/ububall-logo.svg` (place a `1024x1024` icon at `mobile/assets/icon-only.png` with `#101112` background and run `npx @capacitor/assets generate --android`).

4. **Boot and test on your Pixel (`adb devices`):**
   ```powershell
   cd C:\dev\ububall\mobile
   npm run run:android
   ```
   Verify on physical hardware:
   - Cold offline boot (Airplane mode): Quick Play vs CPU, neural-net `.bin` weights, 120 Hz WebGL2 rendering, and synth audio.
   - `#btn-rotate` locks portrait/landscape cleanly; system back gesture closes modals -> steps from Mint/Collection to Play -> opens match pause menu -> minimizes from home; locking phone or switching apps pauses synth/fanfare audio immediately.
   - Collision, Iron Save, Goal horn, and pack-unwrap haptics feel crisp without buzz-spam.
   - Replay `.ububall`, `.ubu` certificate, PNG share card, and WebCodecs 1080p60 `.mp4` exports open the native Android Share/Save sheet.

5. **Online Play & Discord OAuth (Requires Owner Approval Before Worker Deploy):**
   - Do **not** deploy to Cloudflare without explicit owner direction (`AGENTS.md`).
   - Once the updated Worker is deployed (`.\install.ps1`), test Guest online match + WebSocket reconnect and Chrome Custom Tabs Discord OAuth (`ububall://auth#ticket=...` works immediately even before App Links DNS verification).
   - To enable seamless HTTPS App Links (`https://ububall.tch.one/?match=...`), add `"ANDROID_PACKAGE_NAME": "one.tch.ububall"` and `"ANDROID_SHA256_FINGERPRINTS": "<DEBUG_SHA256>,<PLAY_SIGNING_SHA256>"` to `vars` in `%LOCALAPPDATA%\ubumint\settings.json` and redeploy so `https://ububall.tch.one/.well-known/assetlinks.json` serves your signing fingerprints.
