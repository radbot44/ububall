# Development and sandbox notes

Start with [README.md](../README.md) for local use and [worker.md](worker.md) for installation, tests and deployment. These notes are **conditional environment troubleshooting**, not standing protocol instructions.

## Local verification

- `npm test` runs unit/integration suites (dot reporter). `npm run test:worker` runs isolated Worker storage; it must never target production. Use a detailed reporter only to diagnose a failure.
- Target Node **22.13+**. In isolated Node 18 Linux sandboxes, `globalThis.crypto` may require `node --experimental-global-webcrypto --test`; `test/mint.test.js` requires Node 22+ for `node:sqlite`.
- Without `devDependencies` (`esbuild`, `wrangler`), the packaging script and Worker integration suite cannot run. Run zero-dependency suites directly with `node --test`, and report unavailable tests rather than claiming a pass. Eight PowerShell installer subtests are expected to skip on Linux.
- Some name tests/benchmarks use source-text anchors (`const api = { decode,` and `function ubunym(state)`) in `shared/ubu.js`. When modifying this area, inspect those tests and preserve behavior or improve their coupling deliberately. `web/ubu-list.js` must handle partial mock models and `vm.runInNewContext` globals.
- If `/usr/bin/zip` is unavailable, Python's standard `zipfile` can package source without `.git/`, `dist/` or `node_modules/`. For large calibration runs in constrained sandboxes, use 2D `float32` batches (50,000 rows or fewer), not 3D `float64` tensors, to avoid OOM.
