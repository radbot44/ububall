# Cloudflare application

One Worker serves the website and API. Its `MintRegistry` Durable Object stores the mint inventory and issuance records in SQLite. No separate database service, frontend framework or runtime package is required. Wrangler is a pinned development dependency for bundling and testing the actual Workers runtime.

The local application is implemented. Nothing has been deployed or provisioned, and no production keys or Discord application have been created. Transfers/trading, public ownership proofs and key revocation remain separate work.

## Local use

```powershell
npm ci
npm test
npm run test:worker
npm run dev
```

Open http://127.0.0.1:8790/. The viewer accepts custom .ubu files without configuration. The designer is at /demo.html and uses the same `ubu-render.js`; its DNA and rendering rules are unchanged. The original localhost designer can still run separately.

`scripts/prepare-assets.cjs` copies only the explicit frontend files to ignored `dist/public/`. It refuses unexpected output files. Never change the assets directory to the repository root. Rerun `npm run dev` after changing frontend files to refresh the copied assets. API source changes are watched by Wrangler.

To configure local login/minting, copy `.dev.vars.example` to ignored `.dev.vars` and replace its placeholders. Register the exact `/auth/callback` URL for the configured origin in your Discord application. The default origin is http://127.0.0.1:8790; local secure-cookie handling depends on browser localhost support. Use HTTPS for the deployed site.

| Setting | Meaning |
| --- | --- |
| ORIGIN | Exact website origin, no trailing slash or path; HTTPS except loopback development |
| DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET | Discord OAuth application credentials |
| SESSION_SECRET | Canonical unpadded base64url of 32 random bytes; used for session HMAC, separate from mint signing |
| MINT_ID | Permanent canonical base64url of 16 random bytes; keep it stable |
| MINT_KEY_ID | Active signing-key ID |
| MINT_PUBLIC_KEYS | JSON object mapping retained signing-key IDs to Ed25519 public JWK `x` values |
| MINT_PRIVATE_KEYS | Secret JSON object mapping signing-key IDs to their private Ed25519 JWKs |
| BATCH_SIZE | Default 1000; changes affect subsequent batches |
| LIFETIME_MINT_LIMIT | Configurable lifetime issuances per Discord account; defaults to 0, so new issuance is closed |

Secret values belong in ignored local configuration or Cloudflare secrets, never frontend assets, Git or public vars. The example is placeholders only. Tests create ephemeral credentials in memory; there is no automatic production key generation or test-login bypass in the application.

## Requests and ownership

- `GET /api/config` returns configured mint identity/public keys, login availability and the lifetime limit. This is the site's explicit public trust configuration, never a key URL chosen by an imported certificate. If mint configuration is absent, custom viewing remains available.
- `GET /auth/discord` starts Discord's authorization-code flow with the `identify` scope. `GET /auth/callback` verifies a signed, ten-minute state cookie before exchanging a code and fetching the authenticated Discord ID. No Discord credentials or OAuth tokens reach the frontend or registry.
- A signed, one-day HttpOnly/Secure/SameSite=Lax cookie carries the authenticated owner and CSRF token. `GET /api/session` returns only that session's owner and CSRF token. `POST /api/logout` clears its cookie. Sessions are stateless: clearing a browser cookie does not revoke a stolen copy; replacing SESSION_SECRET invalidates all sessions.
- `POST /api/mint` accepts exactly `{ "request": "<16–128 character request ID>" }`. It derives the owner from the authenticated session, validates the configured origin and CSRF header, and passes the configured lifetime limit to the mint transaction. Caller-selected DNA or owner fields are rejected. Bodies are limited to 512 bytes.
- The lifetime allowance counts original issuance records, including allocations whose signing is pending. Retries return the existing allocation even after the limit is reduced. Future transfers must preserve original issuance ownership and count, storing current ownership separately; receiving or giving away an ubu must not reset the mint allowance.
- `GET /api/ubus?sort=recent|old|rarity|serial|favorite&after=<12-digit serial>` returns only the authenticated owner's issued collection, **50 ubus per page** in the selected global order. The `next` cursor is the final serial on the returned page; omit `after` for the first page, and use the same `sort` for subsequent pages. The site fetches the next page only when scrolling reaches it, preserves existing rendered thumbnails and inserts newly revealed ubus at their ordered position. There is no public endpoint exposing Discord IDs or unallocated DNA. No transfer code exists, so issuance owners are also the current owners at this stage.
- `POST /api/favorites` accepts `{ "serial": "000000000001", "favorite": true|false }` for idempotent, owner-checked changes. For one-time migration of legacy browser favorites, it also accepts `{ "serials": ["000000000001", ...] }` with at most 50 serials per request. Both require session, origin and CSRF authorization; unknown/unowned serials cannot be favorited through an account. Favorites persist in the mint registry and are included as booleans with each collection page. The browser imports its old `ubumint:favorites` list after login, in bounded chunks, and only removes it locally after a successful import. On another device, favorites follow the signed-in account.
- A certificate opened locally proves issuance only. The site verifies against its configured public keys before showing verified status; no signed import falls back to custom. Download preserves the original certificate. The browser retains an unfinished mint request ID per mint/account to permit safe retries.

All API/session responses are uncached. Production authentication still needs a live Discord end-to-end check after credentials and the final origin are configured; tests mock Discord responses and never contact real accounts.

## Batch scheduling

The first authorized allocation attempt schedules preparation if no completed batch is available. Requests receive 503 plus Retry-After while preparing. Each alarm prepares at most 100 ubus and schedules recovery before doing the work. Preparation resumes across restarts; completed inventory becomes available only as a whole batch. Exhaustion schedules the next batch automatically. The visitor can retry using the same request ID.

Signing and persistent retry recovery use the existing [mint service](mint.md). Worker key import selects explicit Ed25519 curve/key material to avoid Node/workerd differences in optional JWK algorithm labels. Old signing keys must remain available until pending allocations using them are signed; retain old public keys to verify old certificates. A complete rotation/revocation policy is not implemented.

## Automatic collection schema upgrade

An updated Worker adds two columns to the existing `issued` table on the **first Durable Object access**: `favorite INTEGER NOT NULL DEFAULT 0` and `rarity_bits REAL`, along with sort indexes. Existing issuance rows, serials, owner records, signatures, mint identity, keys and inventory are left unchanged. A transaction-scoped `PRAGMA table_info` check makes the ALTER operations idempotent across restarts and normal deployments. **Do not run `-ResetMint` or create a new mint identity.**

Existing ubus initially have a null rarity sort key. Durable Object alarms backfill **up to 100 records per run**, transactionally, using the same deterministic appearance scoring as the browser. Progress survives restarts; other sort modes and minting keep functioning during backfill. The rarity sort returns HTTP 503 until all historical scores are ready, and the site retries that view automatically. Newly issued ubus save their score in the allocation transaction.

To deploy after merging this PR, update the source checkout and run `./install.ps1 -DryRun` (PowerShell: `.\\install.ps1 -DryRun`) to run the suites before any upload. Then run `.\\install.ps1` to install and deploy as usual with your existing `%LOCALAPPDATA%\\ubumint\\settings.json`; first access performs the migration without an operator-run SQL script. Preserve backups of production settings and registry state before changing production code. **Rollback note:** the pre-upgrade source uses positional inserts into `issued`, so simply redeploying an older version after new columns exist would break new mint issuance. Roll forward with a fix rather than deploying unmodified old code; never reset the mint to undo this update.

## First setup and updates

On Windows, use PowerShell with Node 22.13+ and Git installed. From `C:\dev\ubumint`, run:

```powershell
.\install.ps1                 # install current local source, test, deploy
.\install.ps1 -DryRun         # same checks, no Cloudflare upload
.\install.ps1 -InstallOnly    # copy code only
```

The source checkout is authoritative, including current tracked working edits. You can also run `.\install.ps1` from `ubumint-cloudflare`: it forwards to the recorded source checkout (or sibling `ubumint` for older installations), retaining all switches. This does not pull GitHub or push anything. Update your source checkout first when you want newer code. The installed folder is a deployment copy: do not use `git pull` or stash there. Existing separate code edits stop installation before copying; changes already identical to source are accepted. Replaced files are backed up outside the checkout. Runtime state and ignored files stay in place. The old installation's `.\update.ps1` now invokes this installer; `.\deploy.ps1` tests and redeploys the already installed code without copying updates.

Install and deploy stop before touching the installation when another Wrangler command is using it. Let an existing deployment finish, or close its local dev terminal, before retrying; this avoids Windows executable locks during dependency installation.

On the first run, existing `wrangler.local.jsonc` (or `wrangler.deploy.jsonc`) and `.dev.vars` are recovered into `%LOCALAPPDATA%\ubumint\settings.json`. Production config takes precedence over local development values; missing values and existing secrets come from `.dev.vars`. Recovery validates the matching public/private signing keys. It never generates a replacement mint identity. If credentials were lost everywhere, restore a backup; recovery cannot retrieve deleted secret values from Cloudflare.

**Back up the entire `%LOCALAPPDATA%\ubumint` folder separately.** It contains permanent mint identity, private signing keys, Discord credentials, session secret, deployment settings and automatic backups. Access is restricted to your Windows account and SYSTEM. It survives deleting or recloning either checkout. Keep it private. Edit `settings.json` to change production settings; `vars` contains public settings and `secrets` contains private settings. Saved secrets are uploaded with the code in the same deployment, so missing Worker secrets are restored without rotating keys. Existing unrelated dashboard variables are preserved by `keep_vars`; explicitly saved values take precedence. `wrangler.deploy.jsonc` is generated and ignored. `wrangler.jsonc` stays a generic development template and is never your production settings file.

For a **brand-new mint only**, register a Discord application and its exact HTTPS `/auth/callback` URL, choose your Worker name and final HTTPS origin, then run:

```powershell
.\install.ps1 -Setup
```

Setup prompts for the Worker name, origin and Discord credentials (the secret is hidden). It creates a fresh permanent mint ID, Ed25519 signing key and session secret only when no saved settings exist. Wrangler opens Cloudflare login when needed in an interactive terminal; if authentication fails, run `node node_modules/wrangler/bin/wrangler.js login` from the installation and rerun `deploy.ps1` without Setup. Setup uses workers.dev when the origin ends in `.workers.dev`; otherwise it configures that hostname as a Cloudflare custom domain and disables workers.dev. The custom domain must belong to a zone in your Cloudflare account. The lifetime mint limit starts at **0**; change `vars.LIFETIME_MINT_LIMIT` in saved settings and redeploy when ready to open issuance. Setup refuses to replace existing saved settings. For an existing mint, restore its saved settings instead of running Setup.

`deploy.ps1` stops on dependency, validation, test or upload failures. Both suites use dot output by default; for detailed failures, run the failing file with `node --test --test-reporter=spec <file>`. A successful upload is followed by a public `/api/config` check for login configuration and the saved mint ID. If local DNS cannot resolve the domain, it warns that the upload succeeded and public verification is pending; deleting and recreating a Worker can leave cached missing-domain responses. Run `ipconfig /flushdns`, restart the browser and allow the DNS resolver to refresh. Do not repeat Setup. Other public verification failures remain errors even if Cloudflare accepted the upload. No script deletes production Durable Object storage or migrates local test state into production.

## Verification

### Fresh mint reset

To keep the installation, domain, Discord credentials, batch size and allowance but start a new mint, run `C:\dev\ubumint-cloudflare\deploy.ps1 -ResetMint`. To install current source updates and reset in one step, run `C:\dev\ubumint\install.ps1 -ResetMint` instead. Reset is an explicit operation, never part of a normal update. It cannot be combined with Setup, DryRun or InstallOnly.

Dependencies and both test suites must pass before reset changes settings. Reset then backs up the previous settings under `%LOCALAPPDATA%\ubumint\backups\reset-*`, generates a new mint ID, signing keys and session secret, and deploys. The different mint ID selects a fresh Durable Object registry: empty collections, unused lifetime allowances and serial allocation starting at 1. Previous sessions expire and previous certificates are no longer trusted by the new mint. This preserves permanent serial uniqueness within each mint identity. The old Cloudflare database is retained separately, not physically deleted; saved settings backups are not database backups.

If upload or verification fails after reset is prepared, rerun `deploy.ps1` **without** `-ResetMint` to deploy the already generated identity. Do not reset repeatedly to retry an upload. Normal deployments retain the current identity and data.

`npm test` covers the 512-bit DNA schema, files, mint transactions, lifetime limits and OAuth/session checks. `npm run test:worker` uses Wrangler's local test harness with isolated storage and ephemeral keys. It verifies frontend asset boundaries, private API access, CSRF/body validation, public-key-only configuration, signed issuance, concurrent retries, lifetime-limit rejection, collection isolation, real alarm-driven batch rollover and unfinished preparation recovery after object eviction. Browser checks cover custom import and the shared renderer/designer.

`wrangler.jsonc` has no account, domain route or production identity, disables workers.dev/preview URLs, and preserves dashboard variables. Production deployments use the generated config described above. Deployment requires owner authorization; running tests never deploys.

Official references: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Durable Object SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2).
