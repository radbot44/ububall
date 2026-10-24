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
- `GET /api/ubus?after=<12-digit serial>` returns only the authenticated owner's issued collection, up to 50 rows per page. There is no public endpoint exposing Discord IDs or unallocated DNA. No transfer code exists, so issuance owners are also the current owners at this stage.
- A certificate opened locally proves issuance only. The site verifies against its configured public keys before showing verified status; no signed import falls back to custom. Download preserves the original certificate. The browser retains an unfinished mint request ID per mint/account to permit safe retries.

All API/session responses are uncached. Production authentication still needs a live Discord end-to-end check after credentials and the final origin are configured; tests mock Discord responses and never contact real accounts.

## Batch scheduling

The first authorized allocation attempt schedules preparation if no completed batch is available. Requests receive 503 plus Retry-After while preparing. Each alarm prepares at most 100 ubus and schedules recovery before doing the work. Preparation resumes across restarts; completed inventory becomes available only as a whole batch. Exhaustion schedules the next batch automatically. The visitor can retry using the same request ID.

Signing and persistent retry recovery use the existing [mint service](mint.md). Worker key import selects explicit Ed25519 curve/key material to avoid Node/workerd differences in optional JWK algorithm labels. Old signing keys must remain available until pending allocations using them are signed; retain old public keys to verify old certificates. A complete rotation/revocation policy is not implemented.

## Verification and deployment boundary

`npm test` covers frozen DNA, files, mint transactions, lifetime limits and OAuth/session checks. `npm run test:worker` uses Wrangler's local test harness with isolated storage and ephemeral keys. It verifies frontend asset boundaries, private API access, CSRF/body validation, public-key-only configuration, signed issuance, concurrent retries, lifetime-limit rejection, collection isolation, real alarm-driven batch rollover and unfinished preparation recovery after object eviction. Browser checks cover custom import and the shared renderer/designer.

`wrangler.jsonc` has no account, domain route or production identity, and disables workers.dev/preview URLs. Deployment still requires explicit owner authorization, configured secrets, a chosen nonzero allowance and the intended domain. Do not deploy merely to run tests. Worker storage and local Node SQLite databases are separate; no migration/import of local test state is implied.

Official references: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [Durable Object SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2).
