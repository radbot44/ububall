# Working on ubumint

## Scope

- This is the owner's private ubu mint project, separate from uburoom. Read README.md before planning or changing it.
- The owner froze DNA on 2026-10-23 and authorized continuing with the local .ubu format/signature implementation. Read docs/dna.md, docs/uburithm.md and docs/ubu-file.md before relevant work. Cloud deployment, production keys, accounts, trading, encryption and uburoom integration remain separate work requiring authorization.
- Keep owner requirements distinct from proposed mechanisms and examples. Do not turn an agent recommendation into an approved protocol decision.
- Keep the repository private. Remote creation, pushes, publication, Cloudflare provisioning and deployment require explicit owner authorization. Never embed mint secrets in uburoom or browser code.

## DNA and ubucodes

- DNA is random input to permanent deterministic generation rules, not merely a serialized list of resulting traits.
- DNA is frozen: one closed, permanent schema without generator versions or future expansion. Assigned meanings, naming, geometry, curves and finish interpretation remain fixed. Preserve all DNA bits when reading, storing or exporting.
- Approved DNA block order: 64-bit ubunym seed, 80-bit body-part block (five 16-bit slots), 24-bit mouth corners (six four-bit rolls), 40-bit mouth geometry (four ten-bit fields), 40-bit eye displacement/left-eye flip controls, 8-bit Ubuquity rating. All 256 bits are allocated. docs/dna.md is authoritative; never repurpose existing fields.
- Eyes are solid filled discs with overlaid irises/pupils, not hollow rings. Iris radius equals the prototype opening radius (30.7126), with no seam-concealing oversize. Textures rotate about the ubu outer-circle center.
- The official naming algorithm is the uburithm. Its mechanics and draw order are fixed in docs/uburithm.md. Improve calculation efficiency only while preserving outputs.
- Approved input paths: exact text encoded as UTF-8 then SHA-256 into complete DNA; random DNA generated directly; imported DNA read directly without rehashing. Preserve text case, whitespace and leading zeros. Initialize the name stream directly from the first 64 DNA bits.
- MSB-first bit order, uburithm calculation, slot roles, geometry, curves and finishes are accepted. Default matte and rare metallic/glossy/iridescent/crystalline assignments are permanent. The working .ubu profile is in docs/ubu-file.md; no encryption is selected.
- Keep DNA interpretation separate from its plain, signed or encrypted transport envelope and host acceptance policy. Never reinterpret failed protected codes as plain codes.
- Two .ubu forms are implemented in ubu-file.js: unsigned/custom DNA and an Ed25519-signed issuance certificate. Both use the frozen DNA. Custom ubus never imply official issuance or registered ownership. Signed imports require a caller-trusted mint public key, with no unsigned fallback or file-supplied trust. Hosts may require signed files. The demo has no configured mint trust and imports/exports custom files only; never install test keys as production trust.
- The mint must generate random DNA itself for ordinary minting. Do not authorize caller-selected seeds through the normal mint endpoint.
- Mint-signed certificates include a permanent twelve-digit serial (000000000001–999999999999) covered by the signature. The future registry allocates serials atomically, uniquely per mint, without reuse or wraparound; retries must not mint twice. Custom files have no official serial. This metadata does not alter DNA.
- Approved batch policy: default 1,000, configurable for subsequent batches. Prepare private random DNA/IDs/serials, distribute uniformly without replacement, sign on authorized allocation and start the next batch after exhaustion. Serial order is creation order. Local resumable preparation and atomic, idempotent ownership allocation are implemented in mint.js with mint-local.js; read docs/mint.md. Worker scheduling, authentication and allowances are not implemented. Never expose this internal service directly as a public endpoint.
- Ed25519 and exact signing bytes are implemented; production trust distribution, key rotation and mint allowances remain design work. A public verification key must not grant minting authority. Test private keys remain ephemeral and must never be committed or configured as official mint keys.

## Implementation hygiene

- Owner requirement: a lean mint with zero fluff in code, UI, dependencies, tooling and documentation. Every addition must serve a current requirement; do not build speculative functionality or extension infrastructure.
- Use plain JavaScript and platform APIs by default. No framework, generic plugin system, abstraction layer, build pipeline or dependency without a concrete need that the simpler implementation cannot reasonably meet. Development tooling must also justify its cost.
- Keep the mint request path limited to required generation, validation, cryptography and persistence. Rendering and preview work belongs outside that path. Avoid repeated setup, unnecessary allocations, duplicate conversions and unbounded caches; weigh table memory/startup cost against saved work.
- Prefer one implementation of each rule. Keep modules, API surfaces, UI, logs and documentation small and purposeful; do not duplicate protocol specifications across files.
- Optimize against measured bottlenecks and representative workloads. Report CPU/latency, memory, startup and code-size tradeoffs when material. Do not claim absolute optimality or improved performance without evidence; fewer lines alone is not proof of efficiency.
- Efficiency never permits changing approved DNA laws, weakening randomness or cryptography, bypassing authorization or dropping atomic ownership guarantees. Use platform cryptography; do not implement custom cryptographic primitives.
- Keep private keys, tokens, local bindings and state out of Git, logs and examples. Use placeholders in committed configuration.
- Run repository commands inside this repository. Do not copy production configuration or data from uburoom.
- Add focused verification for protocol, cryptographic, authorization and accounting boundaries when implemented; setup documentation does not need invented tests.
