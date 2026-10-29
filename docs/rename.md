# Ububall Operator Migration Guide

This document provides step-by-step instructions for the future manual migration of the project identity and local checkout from `ubumint` to `ububall`.

> [!WARNING]
> Do NOT execute these migration steps until explicitly authorized by the project owner. The codebase has been prepared with backward-compatible tooling so this migration can be performed cleanly in a single operator session.

---

## 1. What MUST NOT be Renamed or Modified

Preserving production identity, user collections, issued certificates, and data takes strict precedence over cosmetic uniformity:

1. **Cloudflare Worker Name (`wrangler.jsonc` and `settings.json`)**:
   - Keep the Worker name as configured. Do NOT rename the Worker in Cloudflare or `wrangler.jsonc`. Renaming the Worker creates an entirely separate Worker instance and orphan routes rather than updating the production deployment.
2. **Durable Object Bindings & Class Names**:
   - `MINT` (`MintRegistry`) and `UBUBALL` (`UbuballMatch`) must retain their exact binding names and class names in `wrangler.jsonc` and `server/worker.mjs`.
   - Renaming the `MINT` Durable Object cuts off access to all existing persistent SQLite storage, including all minted ubus, registered owner accounts, serial allocations, and pending packs.
3. **Mint ID and Cryptographic Secrets**:
   - `MINT_ID` (`vars.MINT_ID` in `%LOCALAPPDATA%\ubumint\settings.json`) identifies the mint registry instance.
   - `MINT_PRIVATE_KEYS`, `MINT_PUBLIC_KEYS`, and `SESSION_SECRET` must remain untouched.
   - The Ed25519 signing prefix `ubumint:issuance\n` in `shared/ubu-file.js` must NEVER be changed. Existing `.ubu` certificates were signed using this prefix; changing it would invalidate every previously issued certificate.
4. **Browser Storage Keys**:
   - Client storage keys (`ubumint:favorites`, `ubumint:pending:...`, `ubumint:reveal:...`, `ubumint-dna-preview`) must remain unchanged to preserve existing player collections and pending packs in players' browsers.
5. **Deployment Destination & Settings Paths**:
   - The default deployment destination remains `C:\dev\ubumint-cloudflare`.
   - The private settings directory remains `%LOCALAPPDATA%\ubumint`.
   - Do NOT run `-Setup` or `-ResetMint`.

---

## 2. Step-by-Step Migration Procedure

### Step 1: Rename the GitHub Repository
1. Navigate to the repository settings on GitHub:
   `https://github.com/radbot44/ubumint/settings`
2. Under **General > Repository name**, enter `ububall` and click **Rename**.
3. GitHub automatically establishes web and git redirects from `radbot44/ubumint` to `radbot44/ububall`.

### Step 2: Update Local Git Remote URLs
In your local repository, update the git remote so it points to the new repository URL:

```powershell
git remote set-url origin git@github.com:radbot44/ububall.git
# Or if using HTTPS:
# git remote set-url origin https://github.com/radbot44/ububall.git

# Verify the updated remote:
git remote -v
```

### Step 3: Rename the Local Source Checkout Folder
1. Close any running dev servers (`npm run dev`), active terminals, or editors that currently have files open in `C:\dev\ubumint` to avoid Windows file locks.
2. Rename the directory from `C:\dev\ubumint` to `C:\dev\ububall`:
   ```powershell
   Rename-Item -LiteralPath "C:\dev\ubumint" -NewName "ububall"
   ```
3. Update any workspace configurations (such as IDE workspace roots or editor project shortcuts) to point to `C:\dev\ububall`.

### Step 4: Verify Installation Manifest and Forwarding
The Windows installation tooling (`install.ps1` and `update.ps1`) automatically handles the migration:

1. **Automatic Sibling Fallback**:
   Even before updating the manifest, if `install.ps1` or `update.ps1` is run from the deployment copy (`C:\dev\ubumint-cloudflare`), the installer automatically probes for `ububall` if the legacy `ubumint` directory is missing.
2. **Update Manifest via Dry Run**:
   From the newly renamed directory `C:\dev\ububall`, run:
   ```powershell
   cd C:\dev\ububall
   .\install.ps1 -DryRun
   ```
   This will:
   - Run both test suites (`npm test` and `npm run test:worker`).
   - Copy assets and validate deployment configuration.
   - Update `%LOCALAPPDATA%\ubumint\installation.json` to record `source: "C:\dev\ububall"`.
   - Exit cleanly without uploading anything to Cloudflare.
3. **Verify Forwarding from the Installed Copy**:
   From `C:\dev\ubumint-cloudflare`, run:
   ```powershell
   cd C:\dev\ubumint-cloudflare
   .\update.ps1 -DryRun
   ```
   Confirm that the update command correctly forwards to `C:\dev\ububall\install.ps1`.

### Step 5: Verification Checklist

Before performing any real deployment, run the following verification checks:

1. **Core Tests:**
   ```powershell
   cd C:\dev\ububall
   npm test
   ```
   All tests across audio, rendering, physics, match logic, DNA parsing, file formats, appearance rarity, mint transactions, auth, and installer forwarding should pass.

2. **Cloudflare Worker Runtime Tests:**
   ```powershell
   npm run test:worker
   ```
   All integration tests in Wrangler's isolated environment should pass.

3. **Dry-Run Installation:**
   ```powershell
   .\install.ps1 -DryRun
   ```
   Should complete with `--dry-run: exiting now. Dry run complete. Nothing was uploaded to Cloudflare.`

4. **Verify Manifest Content:**
   ```powershell
   Get-Content "$env:LOCALAPPDATA\ubumint\installation.json" | ConvertFrom-Json
   ```
   Verify that `source` points to `C:\dev\ububall` and `destination` points to `C:\dev\ubumint-cloudflare`.

---

## 3. Rollback / Recovery Notes

- If the folder rename needs to be reverted for any reason:
  ```powershell
  Rename-Item -LiteralPath "C:\dev\ububall" -NewName "ubumint"
  ```
- Because `install.ps1` and `update.ps1` check both `ububall` and `ubumint` as sibling candidates, tooling will continue to operate regardless of which directory name is active.
