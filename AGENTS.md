# Working on ubumint

## Scope

- This is the owner's private ubu mint project, separate from uburoom. Read README.md before planning or changing it.
- Current authorization includes the local demo and complete unsigned DNA generation/rendering for appearance review. Do not add mint signatures, encryption, accounts, trading, cloud deployment or uburoom integration to that work. Read docs/dna-draft.md for DNA rules and preview choices; the schema is not frozen until owner acceptance.
- Keep owner requirements distinct from proposed mechanisms and examples. Do not turn an agent recommendation into an approved protocol decision.
- Keep the repository private. Remote creation, pushes, publication, Cloudflare provisioning and deployment require explicit owner authorization. Never embed mint secrets in uburoom or browser code.

## DNA and ubucodes

- DNA is random input to permanent deterministic generation rules, not merely a serialized list of resulting traits.
- The owner requires one closed, permanent DNA schema, without generator versions or future expansion. Pre-freeze preview changes are authorized; after acceptance, assigned meanings and feature rules remain fixed. Preserve all DNA bits when reading, storing or exporting.
- Approved DNA block order: 64-bit ubunym seed, 80-bit body-part block (five 16-bit slots), 24-bit mouth corners (six four-bit rolls), 40-bit mouth geometry (four ten-bit fields), 40-bit eye displacement/left-eye flip controls, 8-bit Ubuquity rating. All 256 bits are allocated. See docs/dna-draft.md for authoritative feature rules and geometry proposals; never repurpose existing fields for expansion.
- Eyes are solid filled discs with overlaid irises/pupils, not hollow rings. Iris radius equals the prototype opening radius (30.7126), with no seam-concealing oversize. Textures rotate about the ubu outer-circle center.
- Naming rules are fixed; the official algorithm is called the uburithm. Review calculation efficiency without changing those rules. docs/uburithm.md distinguishes proposed algorithm mechanics from approved rules.
- Approved input paths: exact text encoded as UTF-8 then SHA-256 into complete DNA; random DNA generated directly; imported DNA read directly without rehashing. Preserve text case, whitespace and leading zeros. Initialize the name stream directly from the first 64 DNA bits.
- Bit reading order, exact uburithm stream calculation, slot role order, geometry, prefixes and cryptographic envelopes remain unresolved until explicitly settled.
- Keep DNA interpretation separate from its plain, signed or encrypted transport envelope and host acceptance policy. Never reinterpret failed protected codes as plain codes.
- The mint must generate random DNA itself for ordinary minting. Do not authorize caller-selected seeds through the normal mint endpoint.
- Signing, encryption, trust distribution, key rotation and mint allowances remain design decisions. A public verification key must not grant minting authority; shared symmetric keys do.

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
